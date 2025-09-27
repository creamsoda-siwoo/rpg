/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const root = document.getElementById('root') as HTMLDivElement;
if (!root) {
  throw new Error('Could not find root element');
}

// --- Type Definitions ---
type StatusEffectType = 'poison' | 'burn' | 'stun' | 'weaken' | 'vulnerable';

interface StatusEffect {
    type: StatusEffectType;
    duration: number;
    potency: number; // For poison/burn damage, or stat reduction %
    sourceId?: string; // e.g., skill ID
}

interface Character {
  name: string;
  hp: number;
  maxHp: number;
  attackPower: number;
  defense: number;
  emoji?: string;
  statusEffects: StatusEffect[];
}

interface PlayerStats {
    maxHp: number;
    attackPower: number;
    defense: number;
    critChance: number;
    evadeChance: number;
}

type ItemSlot = 'weapon' | 'armor';
type Rarity = 'common' | 'uncommon' | 'rare';

interface EquipmentItem {
    id: number;
    name: string;
    type: ItemSlot;
    stats: Partial<PlayerStats>;
    rarity: Rarity;
    cost: number;
    enhancementLevel: number;
    classRestriction: (keyof typeof CLASSES)[];
}

interface UltimateSkill {
    id: string;
    name: string;
    description: (level: number) => string;
    cooldown: number;
    effect: (level: number) => {
        damageMultiplier?: number;
        statusEffect?: { type: StatusEffectType, chance: number, duration: number, potency: number };
        buff?: { stat: keyof PlayerStats, value: number, duration: number, isPercent?: boolean };
        message: string;
    };
}

interface PlayerCharacter extends Character {
    className: keyof typeof CLASSES;
    weaponName: string;
    level: number;
    xp: number;
    xpToNextLevel: number;
    gold: number;
    enhancementStones: number;
    potions: number;
    ultimateSkillLevel: number;
    ultimateSkillCooldown: number;
    activeBuffs: { skillId: string, name: string, duration: number, effect: UltimateSkill['effect']['prototype']['buff'] }[];
    baseStats: PlayerStats;
    equipment: {
        weapon: EquipmentItem | null;
        armor: EquipmentItem | null;
    };
    inventory: EquipmentItem[];
    // These are placeholders, recalculated by recalculatePlayerStats
    maxHp: number;
    attackPower: number;
    defense: number;
    critChance: number;
    evadeChance: number;
}

enum GameScreen {
    START,
    DIFFICULTY_SELECTION,
    CLASS_SELECTION,
    TOWN,
    DUNGEON,
    SHOP,
    TRAINING_GROUND,
    EQUIPMENT,
    ENHANCEMENT,
    DISENCHANT,
}

// --- Game Constants ---
const CRIT_MULTIPLIER = 1.5;
const POTION_HEAL_PERCENT = 0.6;
const BASE_POTION_COST = 20;
const POTION_COST_PER_LEVEL = 5;
const DEFEAT_GOLD_PENALTY = 0.1;
const CLASS_CHANGE_COST = 10000;

const STATUS_EFFECT_DEFINITIONS: { [key in StatusEffectType]: { name: string, icon: string } } = {
    poison: { name: '독', icon: '☠️' },
    burn: { name: '화상', icon: '🔥' },
    stun: { name: '기절', icon: '💫' },
    weaken: { name: '약화', icon: '↓' },
    vulnerable: { name: '취약', icon: '🛡️💥' },
};

const CLASSES = {
    '전사': { emoji: '🛡️', baseHp: 150, baseAtk: 12, baseDef: 3, weapon: '검', crit: 0.1, evade: 0.05 },
    '마법사': { emoji: '🔥', baseHp: 110, baseAtk: 16, baseDef: 0, weapon: '지팡이', crit: 0.1, evade: 0.05 },
    '도적': { emoji: '💨', baseHp: 115, baseAtk: 12, baseDef: 1, weapon: '단검', crit: 0.25, evade: 0.18 },
};

type Difficulty = '쉬움' | '보통' | '어려움';
const DIFFICULTY_SETTINGS = {
    '쉬움': { monsterHpMod: 0.75, monsterAtkMod: 0.75, startGold: 50, startPotions: 5, rewardMod: 0.8 },
    '보통': { monsterHpMod: 1.0, monsterAtkMod: 1.0, startGold: 20, startPotions: 2, rewardMod: 1.0 },
    '어려움': { monsterHpMod: 1.3, monsterAtkMod: 1.3, startGold: 0, startPotions: 1, rewardMod: 1.25 },
};

const ULTIMATE_SKILLS: { [key in keyof typeof CLASSES]: UltimateSkill } = {
    '전사': {
        id: 'w_ultimate',
        name: '철옹성',
        cooldown: 5,
        description: level => `공격력의 200% 피해를 주고, ${2+level}턴 동안 방어력이 ${30 + level * 5}% 증가하는 '철벽' 효과를 얻습니다.`,
        effect: level => ({
            damageMultiplier: 2.0,
            buff: { stat: 'defense', value: 0.30 + level * 0.05, duration: 2 + level, isPercent: true },
            message: '철옹성같은 방어 태세로 적을 공격하고 스스로를 강화했다!'
        })
    },
    '마법사': {
        id: 'm_ultimate',
        name: '메테오',
        cooldown: 5,
        description: level => `공격력의 ${250 + level*20}% 피해를 입히고, 3턴간 턴마다 ${10 + level * 3}의 화상 피해를 줍니다.`,
        effect: level => ({
            damageMultiplier: 2.5 + level * 0.2,
            statusEffect: { type: 'burn', chance: 1.0, duration: 3, potency: 10 + level * 3 },
            message: '하늘에서 거대한 운석이 떨어져 전장을 불태웠다!'
        })
    },
    '도적': {
        id: 'r_ultimate',
        name: '그림자 습격',
        cooldown: 5,
        description: level => `공격력의 ${150 + level*10}% 피해를 2번 입히고, 3턴간 턴마다 ${8 + level * 2}의 독 피해를 줍니다.`,
        effect: level => ({
            damageMultiplier: 1.5 + level * 0.1, // This is per hit
            statusEffect: { type: 'poison', chance: 1.0, duration: 3, potency: 8 + level * 2 },
            message: '그림자처럼 다가가 적의 급소를 2번 연속으로 베었다!'
        })
    }
};

const ITEM_DATABASE: Omit<EquipmentItem, 'enhancementLevel'>[] = [
    // Common
    { id: 101, name: "녹슨 검", type: 'weapon', stats: { attackPower: 2 }, rarity: 'common', cost: 20, classRestriction: ['전사'] },
    { id: 102, name: "해진 로브", type: 'armor', stats: { maxHp: 10 }, rarity: 'common', cost: 20, classRestriction: ['마법사'] },
    { id: 103, name: "가죽 갑옷", type: 'armor', stats: { defense: 1, evadeChance: 0.01 }, rarity: 'common', cost: 25, classRestriction: ['도적'] },
    { id: 104, name: "나무 지팡이", type: 'weapon', stats: { attackPower: 3 }, rarity: 'common', cost: 25, classRestriction: ['마법사'] },
    { id: 105, name: "작은 단검", type: 'weapon', stats: { attackPower: 1, critChance: 0.02 }, rarity: 'common', cost: 30, classRestriction: ['도적'] },
    { id: 106, name: "판금 조끼", type: 'armor', stats: { defense: 2 }, rarity: 'common', cost: 30, classRestriction: ['전사'] },

    // Uncommon
    { id: 201, name: "강철 검", type: 'weapon', stats: { attackPower: 5 }, rarity: 'uncommon', cost: 80, classRestriction: ['전사'] },
    { id: 202, name: "마법사의 로브", type: 'armor', stats: { maxHp: 20, attackPower: 2 }, rarity: 'uncommon', cost: 90, classRestriction: ['마법사'] },
    { id: 203, name: "그림자 사슬 갑옷", type: 'armor', stats: { defense: 2, maxHp: 10, evadeChance: 0.03 }, rarity: 'uncommon', cost: 100, classRestriction: ['도적'] },
    { id: 204, name: "보석 박힌 지팡이", type: 'weapon', stats: { attackPower: 6 }, rarity: 'uncommon', cost: 100, classRestriction: ['마법사'] },
    { id: 205, name: "암살자의 단검", type: 'weapon', stats: { attackPower: 3, critChance: 0.05 }, rarity: 'uncommon', cost: 110, classRestriction: ['도적'] },
    { id: 206, name: "강철 갑옷", type: 'armor', stats: { defense: 4, maxHp: 25 }, rarity: 'uncommon', cost: 120, classRestriction: ['전사'] },
    
    // Rare
    { id: 301, name: "룬 블레이드", type: 'weapon', stats: { attackPower: 8, critChance: 0.03 }, rarity: 'rare', cost: 250, classRestriction: ['전사'] },
    { id: 302, name: "대마법사의 로브", type: 'armor', stats: { maxHp: 30, attackPower: 5, defense: 1 }, rarity: 'rare', cost: 300, classRestriction: ['마법사'] },
    { id: 303, name: "기사의 갑옷", type: 'armor', stats: { defense: 5, maxHp: 40 }, rarity: 'rare', cost: 320, classRestriction: ['전사'] },
];


let player: PlayerCharacter;
let monster: Character;
let hpTrainingCost: number;
let atkTrainingCost: number;
let defTrainingCost: number;
let ultimateTrainingCost: number;
let messageLog: string[];
let currentScreen: GameScreen;
let currentDifficulty: Difficulty;
let dungeonLevel: number;
let dungeonFloor: number;
let isSellMode = false;


const monsterList = [
    { name: '슬라임', emoji: '💧', baseHp: 20, baseAttack: 5, xp: 25, gold: 5, lootTable: [102, 105] },
    { name: '고블린', emoji: '👺', baseHp: 30, baseAttack: 7, xp: 40, gold: 10, lootTable: [101, 103, 105], onHitEffect: {type: 'weaken', chance: 0.2, duration: 2, potency: 0.1} },
    { name: '오크', emoji: '👹', baseHp: 45, baseAttack: 11, xp: 60, gold: 15, lootTable: [101, 106, 201] },
    { name: '독거미', emoji: '🕷️', baseHp: 55, baseAttack: 12, xp: 75, gold: 20, lootTable: [205, 203], onHitEffect: {type: 'poison', chance: 0.4, duration: 3, potency: 4} },
    { name: '스켈레톤', emoji: '💀', baseHp: 65, baseAttack: 14, xp: 85, gold: 25, lootTable: [201, 206] },
];

const bossList = [
    { name: '동굴 트롤', emoji: '🗿', baseHp: 100, baseAttack: 18, xp: 200, gold: 100, lootTable: [201, 206, 205], onHitEffect: {type: 'stun', chance: 0.2, duration: 1, potency: 0} },
    { name: '거대 골렘', emoji: '🤖', baseHp: 150, baseAttack: 23, xp: 300, gold: 150, lootTable: [202, 204, 303], onHitEffect: {type: 'vulnerable', chance: 0.5, duration: 2, potency: 0.25} },
    { name: '흑기사', emoji: '♞', baseHp: 200, baseAttack: 28, xp: 450, gold: 220, lootTable: [301, 303], onHitEffect: {type: 'weaken', chance: 0.4, duration: 3, potency: 0.2} },
    { name: '드래곤', emoji: '🐲', baseHp: 270, baseAttack: 34, xp: 600, gold: 300, lootTable: [301, 302], onHitEffect: {type: 'burn', chance: 0.7, duration: 3, potency: 15} },
];

function createStartScreen() {
  currentScreen = GameScreen.START;
  root.innerHTML = `
    <div class="screen-container">
      <h1>간단 RPG: 강화와 저주</h1>
      <p>직업을 선택하고, 장비를 강화하여 던전을 정복하세요!</p>
      <button id="start-button" class="button">게임 시작</button>
    </div>
  `;
  document.getElementById('start-button')?.addEventListener('click', createDifficultySelectionScreen);
}

function createItemInstance(itemId: number): EquipmentItem | null {
    const itemData = ITEM_DATABASE.find(i => i.id === itemId);
    if (!itemData) return null;

    // Deep copy to create a unique instance
    const newItem: EquipmentItem = JSON.parse(JSON.stringify(itemData));
    newItem.enhancementLevel = 0;
    return newItem;
}

function createDifficultySelectionScreen() {
    currentScreen = GameScreen.DIFFICULTY_SELECTION;
    root.innerHTML = `
        <div class="screen-container">
            <h1>난이도 선택</h1>
            <p>모험의 난이도를 선택하세요.</p>
            <div class="difficulty-selection">
                <button class="difficulty-card" data-difficulty="쉬움">
                    <h2>쉬움</h2>
                    <p>몬스터가 약해지고, 더 많은 자원으로 시작합니다. 편안한 플레이에 적합합니다.</p>
                </button>
                <button class="difficulty-card" data-difficulty="보통">
                    <h2>보통</h2>
                    <p>표준적인 RPG 경험을 제공합니다.</p>
                </button>
                <button class="difficulty-card" data-difficulty="어려움">
                    <h2>어려움</h2>
                    <p>몬스터가 매우 강력합니다. 보상이 크지만, 상당한 도전을 요구합니다.</p>
                </button>
            </div>
        </div>
    `;

    document.querySelectorAll('.difficulty-card').forEach(card => {
        card.addEventListener('click', (e) => {
            currentDifficulty = (e.currentTarget as HTMLElement).dataset.difficulty as Difficulty;
            createClassSelectionScreen();
        });
    });
}


function createClassSelectionScreen() {
    currentScreen = GameScreen.CLASS_SELECTION;
    root.innerHTML = `
        <div class="screen-container">
            <h1>직업 선택</h1>
            <p>모험을 함께할 당신의 직업을 선택하세요.</p>
            <div class="class-selection">
                <button class="class-card" data-class="전사">
                    <h2>전사 🛡️</h2>
                    <p>높은 체력과 방어력. 적을 약화시키고 버티는 전투를 이끌어갑니다.</p>
                </button>
                <button class="class-card" data-class="마법사">
                    <h2>마법사 🔥</h2>
                    <p>강력한 원소 마법으로 적을 불태우거나 얼립니다.</p>
                </button>
                <button class="class-card" data-class="도적">
                    <h2>도적 💨</h2>
                    <p>맹독과 높은 회피율로 적을 서서히 무너뜨립니다.</p>
                </button>
            </div>
        </div>
    `;

    document.querySelectorAll('.class-card').forEach(card => {
        card.addEventListener('click', (e) => {
            const selectedClass = (e.currentTarget as HTMLElement).dataset.class as keyof typeof CLASSES;
            const playerName = prompt("용사님의 이름은 무엇입니까?", "용사") || "용사";
             if (selectedClass) {
                initializeGame(selectedClass, playerName);
            }
        });
    });
}

function createClassChangeScreen() {
    currentScreen = GameScreen.CLASS_SELECTION;
    root.innerHTML = `
        <div class="screen-container">
            <h1>직업 변경</h1>
            <p>새로운 직업을 선택하세요. 기존 직업과 다른 직업을 선택해야 합니다.</p>
            <div class="class-selection">
                <button class="class-card" data-class="전사" ${player.className === '전사' ? 'disabled' : ''}>
                    <h2>전사 🛡️</h2>
                    <p>높은 체력과 방어력. 적을 약화시키고 버티는 전투를 이끌어갑니다.</p>
                </button>
                <button class="class-card" data-class="마법사" ${player.className === '마법사' ? 'disabled' : ''}>
                    <h2>마법사 🔥</h2>
                    <p>강력한 원소 마법으로 적을 불태우거나 얼립니다.</p>
                </button>
                <button class="class-card" data-class="도적" ${player.className === '도적' ? 'disabled' : ''}>
                    <h2>도적 💨</h2>
                    <p>맹독과 높은 회피율로 적을 서서히 무너뜨립니다.</p>
                </button>
            </div>
            <button id="back-to-town" class="button" style="margin-top: 1rem; width: 100%;">마을로 돌아가기</button>
        </div>
    `;

    document.querySelectorAll('.class-card:not([disabled])').forEach(card => {
        card.addEventListener('click', (e) => {
            const newClass = (e.currentTarget as HTMLElement).dataset.class as keyof typeof CLASSES;
            if (newClass && player.gold >= CLASS_CHANGE_COST) {
                player.gold -= CLASS_CHANGE_COST;
                handleChangeClass(newClass);
            }
        });
    });
    document.getElementById('back-to-town')?.addEventListener('click', renderTownScreen);
}

function handleChangeClass(newClass: keyof typeof CLASSES) {
    const classData = CLASSES[newClass];
    
    player.className = newClass;
    player.weaponName = classData.weapon;
    player.baseStats = {
        maxHp: classData.baseHp,
        attackPower: classData.baseAtk,
        defense: classData.baseDef,
        critChance: classData.crit,
        evadeChance: classData.evade,
    };

    player.ultimateSkillLevel = 1;
    player.ultimateSkillCooldown = 0;
    
    // Unequip items that the new class can't use
    (Object.keys(player.equipment) as ItemSlot[]).forEach(slot => {
        const item = player.equipment[slot];
        if (item && !item.classRestriction.includes(newClass)) {
            unequipItem(slot);
        }
    });

    hpTrainingCost = 100;
    atkTrainingCost = 100;
    defTrainingCost = 100;
    ultimateTrainingCost = 250;

    recalculatePlayerStats();
    player.hp = player.maxHp;

    messageLog.unshift(`✨ 직업을 ${newClass}(으)로 변경했습니다!`);
    renderTownScreen();
}

function initializeGame(chosenClass: keyof typeof CLASSES, playerName: string) {
  hpTrainingCost = 100;
  atkTrainingCost = 100;
  defTrainingCost = 100;
  ultimateTrainingCost = 250;
  dungeonLevel = 1;

  const classData = CLASSES[chosenClass];
  const difficultySettings = DIFFICULTY_SETTINGS[currentDifficulty];
  
  player = {
    name: playerName,
    className: chosenClass,
    weaponName: classData.weapon,
    level: 1,
    xp: 0,
    xpToNextLevel: 100,
    gold: difficultySettings.startGold,
    enhancementStones: 0,
    potions: difficultySettings.startPotions,
    ultimateSkillLevel: 1,
    ultimateSkillCooldown: 0,
    activeBuffs: [],
    statusEffects: [],
    equipment: { weapon: null, armor: null },
    inventory: [],
    baseStats: {
        maxHp: classData.baseHp,
        attackPower: classData.baseAtk,
        defense: classData.baseDef,
        critChance: classData.crit,
        evadeChance: classData.evade,
    },
    hp: 0, maxHp: 0, attackPower: 0, defense: 0, 
    critChance: 0, evadeChance: 0
  };
  recalculatePlayerStats();
  player.hp = player.maxHp;
  messageLog = ['마을에 도착했다. 모험을 준비하자.'];
  renderTownScreen();
}

function recalculatePlayerStats() {
    const p = player;
    
    // Start with base stats
    const tempStats = { ...p.baseStats };
    
    // Equipment
    Object.values(p.equipment).forEach(item => {
        if (item) {
            Object.entries(item.stats).forEach(([stat, value]) => {
                if (stat in tempStats) {
                    (tempStats[stat as keyof PlayerStats] as number) += value;
                }
            });
        }
    });

    // Apply main stats from temp object to player
    p.maxHp = tempStats.maxHp;
    p.attackPower = tempStats.attackPower;
    p.defense = tempStats.defense;
    p.critChance = tempStats.critChance;
    p.evadeChance = tempStats.evadeChance;

    // Buffs
    let buffAtkPercent = 0;
    let buffDefPercent = 0;
    p.activeBuffs.forEach(buff => {
        const b = buff.effect;
        if (!b) return;
        if (b.isPercent) {
            if (b.stat === 'attackPower') buffAtkPercent += b.value;
            if (b.stat === 'defense') buffDefPercent += b.value;
        } else {
             p[b.stat as keyof PlayerStats] += b.value;
        }
    });
    
    p.attackPower = Math.floor(p.attackPower * (1 + buffAtkPercent));
    p.defense = Math.floor(p.defense * (1 + buffDefPercent));
    
    // Status Effects (after buffs, as they are temporary debuffs)
    p.statusEffects.forEach(se => {
        if (se.type === 'weaken') p.attackPower = Math.floor(p.attackPower * (1 - se.potency));
        if (se.type === 'vulnerable') p.defense = Math.floor(p.defense * (1 - se.potency));
    });


    p.hp = Math.min(p.hp, p.maxHp);
}

function getFloorsForDungeon(level: number): number {
    return 3 + Math.floor((level - 1) / 3);
}

function renderTownScreen() {
    currentScreen = GameScreen.TOWN;
    const canAffordClassChange = player.gold >= CLASS_CHANGE_COST;

    root.innerHTML = `
        <div class="screen-container town-screen">
            <p>현재 도전할 던전: ${dungeonLevel} 레벨</p>
            ${createCharacterCard(player, true)}
            <div id="action-buttons" class="town-actions">
                <button data-action="dungeon" class="button">던전 입장</button>
                <button data-action="shop" class="button">상점</button>
                <button data-action="equipment" class="button">장비</button>
                <button data-action="enhancement" class="button">장비 강화</button>
                <button data-action="disenchant" class="button">장비 분해</button>
                <button data-action="training" class="button">단련장</button>
                <button data-action="class-change" class="button" ${!canAffordClassChange ? 'disabled' : ''}>직업 변경 (${CLASS_CHANGE_COST} G)</button>
            </div>
        </div>
    `;

    document.getElementById('action-buttons')?.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const button = target.closest('button');
        if (!button || button.disabled) return;

        switch(button.dataset.action) {
            case 'dungeon':
                startDungeon();
                break;
            case 'shop':
                renderShopScreen();
                break;
            case 'equipment':
                renderEquipmentScreen();
                break;
            case 'enhancement':
                renderEnhancementScreen();
                break;
            case 'disenchant':
                renderDisenchantScreen();
                break;
            case 'training':
                renderTrainingGroundScreen();
                break;
            case 'class-change':
                if (confirm(`직업을 변경하시겠습니까? ${CLASS_CHANGE_COST} 골드가 소모되며, 모든 단련으로 올린 능력치가 초기화됩니다.`)) {
                    createClassChangeScreen();
                }
                break;
        }
    });
}

function startDungeon() {
    dungeonFloor = 1;
    messageLog = [`던전 ${dungeonLevel} - ${dungeonFloor}층에 진입했다.`];
    spawnMonster();
    renderDungeonScreen();
}

function spawnMonster() {
    const floors = getFloorsForDungeon(dungeonLevel);
    const isBossFloor = dungeonFloor === floors;
    let monsterData;

    if (isBossFloor) {
        monsterData = bossList[Math.min(dungeonLevel - 1, bossList.length - 1)];
    } else {
        const monsterPool = monsterList.slice(0, Math.min(monsterList.length, dungeonLevel + 1));
        const monsterIndex = Math.floor(Math.random() * monsterPool.length);
        monsterData = monsterPool[monsterIndex];
    }
    
    const difficulty = DIFFICULTY_SETTINGS[currentDifficulty];
    const levelModifier = Math.pow(1.15, dungeonLevel - 1);
    
    monster = {
        name: isBossFloor ? `👑 ${monsterData.name}` : monsterData.name,
        emoji: monsterData.emoji,
        maxHp: Math.floor(monsterData.baseHp * levelModifier * difficulty.monsterHpMod),
        hp: Math.floor(monsterData.baseHp * levelModifier * difficulty.monsterHpMod),
        attackPower: Math.floor(monsterData.baseAttack * levelModifier * difficulty.monsterAtkMod),
        defense: 0,
        statusEffects: [],
    };
}

function getItemDisplayName(item: EquipmentItem | null): string {
    if (!item) return '맨손';
    return `${item.name}${item.enhancementLevel > 0 ? ` +${item.enhancementLevel}` : ''}`;
}

function createCharacterCard(character: Character, isPlayer: boolean) {
    const hpPercentage = (character.hp / character.maxHp) * 100;

    const statusEffectsHtml = character.statusEffects.map(se => {
        const def = STATUS_EFFECT_DEFINITIONS[se.type];
        return `<span class="status-effect-icon" title="${def.name}: ${se.duration}턴 남음">${def.icon}(${se.duration})</span>`;
    }).join('');

    if (isPlayer && 'className' in character) {
        const p = character as PlayerCharacter;
        const ultimateSkill = ULTIMATE_SKILLS[p.className];
        const xpPercentage = (p.xp / p.xpToNextLevel) * 100;
        const floors = getFloorsForDungeon(dungeonLevel);
        const dungeonInfo = currentScreen === GameScreen.DUNGEON
            ? `<p class="dungeon-progress">던전 ${dungeonLevel} - ${dungeonFloor}/${floors}층</p>`
            : '';
        
        const buffsHtml = p.activeBuffs.map(buff => 
            `<span class="buff-icon" title="${buff.name}: ${buff.duration}턴 남음">${buff.name.substring(0,2)}(${buff.duration})</span>`
        ).join('');
        
        const equipmentHtml = `
            <div class="player-equipment">
                <span>⚔️ ${getItemDisplayName(p.equipment.weapon) || '맨손'}</span>
                <span>🛡️ ${getItemDisplayName(p.equipment.armor) || '맨몸'}</span>
            </div>
        `;
        const ultimateSkillHtml = currentScreen !== GameScreen.TOWN ? '' : `
             <div class="ultimate-skill-display">
                <strong>특수 기술:</strong> ${ultimateSkill.name} (Lv.${p.ultimateSkillLevel})
             </div>
        `;

        return `
            <div class="character-card player-card">
                <div class="player-header">
                    <h2>${p.name} <span class="player-class">(${p.className} ${CLASSES[p.className].emoji} Lv.${p.level})</span></h2>
                    <div class="gold-sp-display">
                        <p>💰 Gold: ${p.gold}</p>
                        <p>💎 Stones: ${p.enhancementStones}</p>
                    </div>
                </div>
                 ${dungeonInfo}
                <div class="hp-bar-container">
                    <div class="hp-bar" style="width: ${hpPercentage}%;"></div>
                </div>
                <p>HP: ${p.hp} / ${p.maxHp}</p>
                <div class="status-effects">${statusEffectsHtml}</div>
                <div class="xp-bar-container">
                    <div class="xp-bar" style="width: ${xpPercentage}%;"></div>
                </div>
                <p>XP: ${p.xp} / ${p.xpToNextLevel}</p>
                <div class="player-stats">
                    <span>⚔️ ATK: ${p.attackPower}</span>
                    <span>🛡️ DEF: ${p.defense}</span>
                    <span>🧪 물약: ${p.potions}</span>
                </div>
                ${equipmentHtml}
                 ${ultimateSkillHtml}
                <div class="player-buffs">${buffsHtml}</div>
            </div>
        `;
    }

    return `
        <div class="character-card monster-card">
            <h2>${character.name} ${character.emoji || ''}</h2>
            <div class="hp-bar-container">
                <div class="hp-bar" style="width: ${hpPercentage}%;"></div>
            </div>
            <p>HP: ${character.hp} / ${character.maxHp}</p>
            <div class="status-effects">${statusEffectsHtml}</div>
        </div>
    `;
}

function renderDungeonScreen() {
    if (currentScreen !== GameScreen.TOWN && currentScreen !== GameScreen.DUNGEON) return;
    currentScreen = GameScreen.DUNGEON;
    
    const ultimateSkill = ULTIMATE_SKILLS[player.className];
    const cooldown = player.ultimateSkillCooldown;
    const disabled = cooldown > 0;
    const skillButton = `<button data-action="ultimate" class="button skill-button" ${disabled ? 'disabled' : ''}>${ultimateSkill.name} ${disabled ? `(${cooldown})` : ''}</button>`;

    root.innerHTML = `
        <div id="game-world">
            ${createCharacterCard(monster, false)}
            ${createCharacterCard(player, true)}
        </div>
        <div id="message-log">
            ${messageLog.map(msg => `<p>${msg}</p>`).join('')}
        </div>
        <div id="action-buttons">
            <button data-action="attack" class="button">공격</button>
            <button data-action="potion" class="button" ${player.potions <= 0 ? 'disabled' : ''}>물약 (${player.potions})</button>
            ${skillButton}
        </div>
    `;

    const logContainer = document.getElementById('message-log');
    if (logContainer) logContainer.scrollTop = logContainer.scrollHeight;

    document.getElementById('action-buttons')?.addEventListener('click', handleDungeonAction);
}

function handleDungeonAction(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const button = target.closest('button');
    if (!button || button.disabled) return;

    const action = button.dataset.action;
    switch (action) {
        case 'attack':
            handlePlayerTurn(handleAttack);
            break;
        case 'potion':
            handleUsePotion();
            break;
        case 'ultimate':
            handlePlayerTurn(handleUseUltimateSkill);
            break;
    }
}

function handlePlayerTurn(action: () => void) {
    // Process player's start-of-turn effects
    const isStunned = processStatusEffects(player);
    if (isStunned) {
        addMessage(`💫 ${player.name}은(는) 기절해서 움직일 수 없다!`);
        handleMonsterTurn();
        return;
    }

    // Decrement cooldowns and buff durations
    if (player.ultimateSkillCooldown > 0) {
        player.ultimateSkillCooldown--;
    }
    player.activeBuffs = player.activeBuffs.map(buff => ({ ...buff, duration: buff.duration - 1 })).filter(buff => buff.duration > 0);
    recalculatePlayerStats();

    // Player action
    action();

    // Check monster status
    if (monster.hp <= 0) {
        monsterDefeated();
    } else {
        // Start monster turn
        handleMonsterTurn();
    }
}

function handleMonsterTurn() {
    // Process monster's start-of-turn effects
    const isStunned = processStatusEffects(monster);
    recalculatePlayerStats(); // Recalculate in case monster stats changed (e.g. vulnerable wore off)
    if (isStunned) {
        addMessage(`💫 ${monster.name}은(는) 기절해서 움직일 수 없다!`);
        renderDungeonScreen();
        return;
    }

    // Monster action
    monsterAttack();
    
    // Check player status
    if (player.hp <= 0) {
        handlePlayerDefeat();
    } else {
        renderDungeonScreen();
    }
}

function addMessage(message: string) {
    messageLog.unshift(message);
    if (messageLog.length > 5) messageLog.pop();
}

function handleAttack() {
    let playerDamage = Math.floor(player.attackPower + (Math.random() * 5 - 2));
    if (Math.random() < player.critChance) {
        playerDamage = Math.floor(playerDamage * CRIT_MULTIPLIER);
        addMessage(`💥 치명타! ${player.name}이(가) ${monster.name}에게 ${playerDamage}의 데미지를 입혔다!`);
    } else {
        addMessage(`⚔️ ${player.name}이(가) ${monster.name}에게 ${playerDamage}의 데미지를 입혔다.`);
    }
    monster.hp = Math.max(0, monster.hp - playerDamage);
}

function handleUseUltimateSkill() {
    const skill = ULTIMATE_SKILLS[player.className];
    if (player.ultimateSkillCooldown > 0) return;
    
    const effect = skill.effect(player.ultimateSkillLevel);
    
    addMessage(`✨ ${effect.message}`);
    player.ultimateSkillCooldown = skill.cooldown;

    const applyDamage = (multiplier: number) => {
        let damage = player.attackPower * multiplier;
        if (Math.random() < player.critChance) {
            damage = Math.floor(damage * CRIT_MULTIPLIER);
            addMessage(`💥 치명타! ${Math.floor(damage)}의 피해!`);
        }
        monster.hp = Math.max(0, monster.hp - Math.floor(damage));
    };

    if (effect.damageMultiplier) {
        if (player.className === '도적') { // Special multi-hit logic
            applyDamage(effect.damageMultiplier);
            if (monster.hp > 0) {
                applyDamage(effect.damageMultiplier);
            }
        } else {
            applyDamage(effect.damageMultiplier);
        }
    }

    if (effect.buff) {
        player.activeBuffs.push({ skillId: skill.id, name: skill.name, duration: effect.buff.duration + 1, effect: effect.buff });
        recalculatePlayerStats();
    }
    
    if (effect.statusEffect && Math.random() < effect.statusEffect.chance) {
        applyStatusEffect(monster, { ...effect.statusEffect });
    }
}

function handleUsePotion() {
    if (player.potions <= 0) return;
    player.potions--;
    const healAmount = Math.floor(player.maxHp * POTION_HEAL_PERCENT);
    player.hp = Math.min(player.maxHp, player.hp + healAmount);
    addMessage(`🧪 물약을 사용해 HP를 ${healAmount}만큼 회복했다!`);
    renderDungeonScreen(); // Rerender immediately, does not start monster turn
}

function monsterAttack() {
    if (Math.random() < player.evadeChance) {
        addMessage(`🍃 ${player.name}이(가) 공격을 회피했다!`);
        return;
    }
    
    let monsterDamage = Math.floor(monster.attackPower + (Math.random() * 4 - 2));
    if (Math.random() < 0.1) { // Monster Crit Chance
        monsterDamage = Math.floor(monsterDamage * CRIT_MULTIPLIER);
        addMessage(`💢 치명타! ${monster.name}이(가) ${monsterDamage}의 데미지를 입혔다!`);
    }
    const finalDamage = Math.max(1, monsterDamage - player.defense);
    addMessage(`🛡️ ${monster.name}의 공격! ${player.name}은(는) ${finalDamage}의 피해를 입었다.`);
    player.hp = Math.max(0, player.hp - finalDamage);

    const baseMonsterData = (monster.name.startsWith('👑') ? bossList : monsterList).find(m => monster.name.includes(m.name));
    if (baseMonsterData?.onHitEffect) {
        const effect = baseMonsterData.onHitEffect;
        if (Math.random() < effect.chance) {
            applyStatusEffect(player, { 
                type: effect.type as StatusEffectType, 
                duration: effect.duration, 
                potency: effect.potency 
            });
        }
    }
}

function generateLoot(monsterData: any): EquipmentItem | null {
    const dropChance = monster.name.startsWith('👑') ? 0.5 : 0.15; // 50% for boss, 15% for normal
    if (Math.random() > dropChance) return null;

    const possibleLootIds = monsterData.lootTable.filter((id: number) => {
        const item = ITEM_DATABASE.find(i => i.id === id);
        if (!item) return false;
        // Basic filtering to avoid very high level items at low levels
        return dungeonLevel >= (item.rarity === 'rare' ? 3 : (item.rarity === 'uncommon' ? 2 : 1));
    });

    if (possibleLootIds.length === 0) return null;

    const lootId = possibleLootIds[Math.floor(Math.random() * possibleLootIds.length)];
    return createItemInstance(lootId);
}

function monsterDefeated() {
    addMessage(`🎉 ${monster.name}을(를) 물리쳤다!`);
    const floors = getFloorsForDungeon(dungeonLevel);
    const isBossFloor = dungeonFloor === floors;
    const baseMonsterData = (isBossFloor ? bossList : monsterList).find(m => monster.name.includes(m.name));
    if (!baseMonsterData) return;
    
    const difficulty = DIFFICULTY_SETTINGS[currentDifficulty];
    const xpGained = Math.floor(baseMonsterData.xp * (1 + (dungeonLevel - 1) * 0.15) * difficulty.rewardMod);
    const goldGained = Math.floor((baseMonsterData.gold + Math.random() * baseMonsterData.gold * dungeonLevel) * difficulty.rewardMod);

    player.xp += xpGained;
    player.gold += goldGained;
    addMessage(`🌟 경험치 ${xpGained}을(를) 획득했다!`);
    addMessage(`💰 골드 ${goldGained}을(를) 획득했다!`);

    // Loot Drop
    const droppedItem = generateLoot(baseMonsterData);
    if (droppedItem) {
        player.inventory.push(droppedItem);
        addMessage(`💎 전리품 획득: <span class="rarity-${droppedItem.rarity}">${droppedItem.name}</span>!`);
    }
    
    while (player.xp >= player.xpToNextLevel) {
        player.xp -= player.xpToNextLevel; 
        levelUp();
    }

    if (isBossFloor) {
        renderDungeonClearScreen();
    } else {
        renderNextFloorScreen();
    }
}

function levelUp() {
    player.level++;
    player.xpToNextLevel = Math.floor(player.xpToNextLevel * 1.5);
    addMessage(`✨ 레벨업! 레벨 ${player.level}이 되었다!`);
    
    const classData = CLASSES[player.className];
    player.baseStats.maxHp += Math.round(classData.baseHp * 0.1);
    player.baseStats.attackPower += Math.round(classData.baseAtk * 0.1);
    player.baseStats.defense += Math.round(classData.baseDef * 0.1);

    const previousMaxHp = player.maxHp;
    recalculatePlayerStats();
    const hpGain = player.maxHp - previousMaxHp;
    player.hp += hpGain;
    player.hp = Math.min(player.hp, player.maxHp);
}

function renderNextFloorScreen() {
    root.innerHTML = `
        <div class="screen-container">
            <h1>전투 승리!</h1>
            <p>던전의 다음 층으로 이동합니다.</p>
            <div id="action-buttons" class="town-actions">
                <button id="continue-button" class="button">다음 층으로</button>
            </div>
        </div>
    `;
    document.getElementById('continue-button')?.addEventListener('click', continueDungeon);
}

function continueDungeon() {
    dungeonFloor++;
    messageLog = [`던전 ${dungeonLevel} - ${dungeonFloor}층으로 이동했다.`];
    spawnMonster();
    renderDungeonScreen();
}

function renderDungeonClearScreen() {
    addMessage(`🏆 던전 ${dungeonLevel} 클리어! 마을로 귀환합니다.`);
    root.innerHTML = `
        <div class="screen-container">
            <h1>던전 클리어!</h1>
            <p>강력한 보스를 물리쳤습니다!</p>
             <div id="action-buttons" class="town-actions">
                <button id="return-town-button" class="button">마을로 돌아가기</button>
            </div>
        </div>
    `;
    dungeonLevel++;
    document.getElementById('return-town-button')?.addEventListener('click', () => {
        player.hp = player.maxHp;
        player.statusEffects = [];
        player.activeBuffs = [];
        recalculatePlayerStats();
        renderTownScreen();
    });
}

function getCurrentPotionCost(): number {
    return BASE_POTION_COST + (dungeonLevel - 1) * POTION_COST_PER_LEVEL;
}

function renderShopScreen() {
    currentScreen = GameScreen.SHOP;
    const itemsForSale = [
        ...ITEM_DATABASE.filter(i => i.rarity === 'common' && i.cost < 50),
        ...ITEM_DATABASE.filter(i => i.rarity === 'uncommon' && dungeonLevel >= 2).slice(0, 2),
        ...ITEM_DATABASE.filter(i => i.rarity === 'rare' && dungeonLevel >= 4).slice(0, 1),
    ].slice(0, 4); // Show a limited selection

    const currentPotionCost = getCurrentPotionCost();

    const itemsHtml = itemsForSale.map(item => `
        <div class="shop-item">
            <span class="rarity-${item.rarity}">${item.name} (${item.type === 'weapon' ? '무기' : '방어구'})</span>
            <button class="button buy-item-btn" data-item-id="${item.id}" ${player.gold < item.cost ? 'disabled' : ''}>${item.cost} G</button>
        </div>
    `).join('');

    root.innerHTML = `
        <div class="screen-container shop-container">
            <h1>상점</h1>
            <p class="gold-display">💰 Gold: ${player.gold}</p>
            <div class="shop-items">
                <div class="shop-item">
                    <span>🧪 회복 물약 구매</span>
                    <button class="button" id="buy-potion" ${player.gold < currentPotionCost ? 'disabled' : ''}>${currentPotionCost} G</button>
                </div>
                ${itemsHtml}
            </div>
            <button id="back-to-town" class="button">마을로 돌아가기</button>
        </div>
    `;
    document.getElementById('buy-potion')?.addEventListener('click', () => {
        const cost = getCurrentPotionCost();
        if (player.gold >= cost) {
            player.gold -= cost;
            player.potions++;
            renderShopScreen();
        }
    });
    document.querySelectorAll('.buy-item-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const itemId = parseInt((e.currentTarget as HTMLElement).dataset.itemId || '0');
            const item = createItemInstance(itemId);
            if (item && player.gold >= item.cost) {
                player.gold -= item.cost;
                player.inventory.push(item);
                addMessage(`🛒 상점에서 <span class="rarity-${item.rarity}">${item.name}</span>을(를) 구매했다.`);
                renderShopScreen();
            }
        });
    });
    document.getElementById('back-to-town')?.addEventListener('click', renderTownScreen);
}


function renderTrainingGroundScreen() {
    currentScreen = GameScreen.TRAINING_GROUND;
    const ultimateSkill = ULTIMATE_SKILLS[player.className];
    root.innerHTML = `
        <div class="screen-container shop-container">
            <h1>단련장</h1>
            <p class="gold-display">💰 Gold: ${player.gold}</p>
            <div class="shop-items">
                <div class="shop-item" title="${ultimateSkill.description(player.ultimateSkillLevel + 1)}">
                    <span>✨ 특수 기술 단련 (${ultimateSkill.name} Lv.${player.ultimateSkillLevel} → Lv.${player.ultimateSkillLevel+1})</span>
                    <button class="button" id="train-ultimate" ${player.gold < ultimateTrainingCost ? 'disabled' : ''}>${ultimateTrainingCost} G</button>
                </div>
                <div class="shop-item">
                    <span>❤️ 최대 생명력 단련 (+10 HP)</span>
                    <button class="button" id="train-hp" ${player.gold < hpTrainingCost ? 'disabled' : ''}>${hpTrainingCost} G</button>
                </div>
                <div class="shop-item">
                    <span>⚔️ 공격력 단련 (+2 ATK)</span>
                    <button class="button" id="train-atk" ${player.gold < atkTrainingCost ? 'disabled' : ''}>${atkTrainingCost} G</button>
                </div>
                <div class="shop-item">
                    <span>🛡️ 보호력 단련 (+1 DEF)</span>
                    <button class="button" id="train-def" ${player.gold < defTrainingCost ? 'disabled' : ''}>${defTrainingCost} G</button>
                </div>
            </div>
            <button id="back-to-town" class="button">마을로 돌아가기</button>
        </div>
    `;
    document.getElementById('train-ultimate')?.addEventListener('click', () => {
        if (player.gold >= ultimateTrainingCost) {
            player.gold -= ultimateTrainingCost;
            player.ultimateSkillLevel++;
            ultimateTrainingCost = Math.floor(ultimateTrainingCost * 1.75);
            recalculatePlayerStats();
            renderTrainingGroundScreen();
        }
    });
    document.getElementById('train-hp')?.addEventListener('click', () => {
        if (player.gold >= hpTrainingCost) {
            player.gold -= hpTrainingCost;
            player.baseStats.maxHp += 10;
            hpTrainingCost = Math.floor(hpTrainingCost * 1.2);
            recalculatePlayerStats();
            player.hp = player.maxHp;
            renderTrainingGroundScreen();
        }
    });
    document.getElementById('train-atk')?.addEventListener('click', () => {
        if (player.gold >= atkTrainingCost) {
            player.gold -= atkTrainingCost;
            player.baseStats.attackPower += 2;
            atkTrainingCost = Math.floor(atkTrainingCost * 1.25);
            recalculatePlayerStats();
            renderTrainingGroundScreen();
        }
    });
    document.getElementById('train-def')?.addEventListener('click', () => {
        if (player.gold >= defTrainingCost) {
            player.gold -= defTrainingCost;
            player.baseStats.defense += 1;
            defTrainingCost = Math.floor(defTrainingCost * 1.3);
            recalculatePlayerStats();
            renderTrainingGroundScreen();
        }
    });
    document.getElementById('back-to-town')?.addEventListener('click', renderTownScreen);
}

function handlePlayerDefeat() {
    const goldLost = Math.floor(player.gold * DEFEAT_GOLD_PENALTY);
    player.gold -= goldLost;
    messageLog = [`골드 ${goldLost}를 잃었다...`, '정신을 차려보니 마을이었다.', `던전 ${dungeonFloor}층에서 쓰러졌다.`];
    
    player.activeBuffs = [];
    player.statusEffects = [];
    recalculatePlayerStats();
    player.hp = player.maxHp;
    renderTownScreen();
}

function getSellPrice(item: EquipmentItem): number {
    return Math.floor(item.cost * 0.4 + item.cost * item.enhancementLevel * 0.1);
}

function handleSellItemClick(event: MouseEvent) {
    const card = event.currentTarget as HTMLElement;
    const inventoryIndexStr = card.dataset.inventoryIndex;
    if (inventoryIndexStr === undefined) return;

    const index = parseInt(inventoryIndexStr);
    const item = player.inventory[index];

    if (!item) return;

    const sellPrice = getSellPrice(item);
    const isValuable = item.rarity === 'rare' || item.enhancementLevel >= 5;
    
    const confirmationMessage = `정말로 '${getItemDisplayName(item)}'을(를) ${sellPrice}G에 판매하시겠습니까?`;

    if (!isValuable || confirm(confirmationMessage)) {
        player.gold += sellPrice;
        const soldItemName = getItemDisplayName(item);
        player.inventory.splice(index, 1);
        addMessage(`💰 ${soldItemName}을(를) 판매하여 ${sellPrice}G를 얻었습니다.`);
        renderEquipmentScreen(); // Re-render to update UI
    }
}


function renderEquipmentScreen() {
    currentScreen = GameScreen.EQUIPMENT;

    const createItemCard = (item: EquipmentItem | null, slot: ItemSlot | 'inventory', index?: number) => {
        if (!item) {
            return `<div class="item-card empty" data-slot="${slot}">비어있음</div>`;
        }
        const isRestricted = !item.classRestriction.includes(player.className);
        const statsHtml = Object.entries(item.stats).map(([stat, value]) => {
            let statName = '';
            switch(stat) {
                case 'maxHp': statName = 'HP'; break;
                case 'attackPower': statName = 'ATK'; break;
                case 'defense': statName = 'DEF'; break;
                case 'critChance': statName = '치명타'; value = (value as number) * 100; return `${statName} +${value.toFixed(0)}%`;
                case 'evadeChance': statName = '회피'; value = (value as number) * 100; return `${statName} +${value.toFixed(0)}%`;
            }
            return `${statName} +${value}`;
        }).join(', ');
        
        const sellOverlayHtml = isSellMode && item && slot === 'inventory' 
            ? `<div class="sell-overlay">판매: ${getSellPrice(item)} G</div>` 
            : '';

        return `
            <div class="item-card rarity-${item.rarity} ${isRestricted ? 'restricted' : ''} ${isSellMode && slot === 'inventory' ? 'sellable' : ''}" data-slot="${slot}" data-item-id="${item.id}" ${index !== undefined ? `data-inventory-index="${index}"` : ''}>
                <p class="item-name">${getItemDisplayName(item)}</p>
                <p class="item-stats">${statsHtml}</p>
                ${isRestricted ? `<div class="restricted-overlay">장착불가</div>` : ''}
                ${sellOverlayHtml}
            </div>
        `;
    };

    const inventoryHtml = player.inventory.map((item, index) => createItemCard(item, 'inventory', index)).join('');

    root.innerHTML = `
        <div class="screen-container equipment-screen">
            <h1>장비</h1>
            <div class="gold-sp-display top-display">
                <p>💰 Gold: ${player.gold}</p>
                <p>💎 Stones: ${player.enhancementStones}</p>
            </div>
            <div class="equipment-slots">
                <div class="slot-container">
                    <h3>무기</h3>
                    ${createItemCard(player.equipment.weapon, 'weapon')}
                </div>
                <div class="slot-container">
                    <h3>방어구</h3>
                    ${createItemCard(player.equipment.armor, 'armor')}
                </div>
            </div>
            <h2>인벤토리 ${isSellMode ? '<span class="sell-mode-indicator">(판매 모드)</span>' : ''}</h2>
            <div class="inventory-grid ${isSellMode ? 'sell-mode' : ''}">
                ${inventoryHtml || '<p>인벤토리가 비어있습니다.</p>'}
            </div>
            <div class="equipment-screen-footer">
                <button id="sell-toggle-button" class="button">${isSellMode ? '판매 종료' : '장비 판매'}</button>
                <button id="back-to-town-equip" class="button">마을로 돌아가기</button>
            </div>
        </div>
    `;
    
    document.querySelectorAll('.item-card').forEach(card => {
        const slot = (card as HTMLElement).dataset.slot;
        if (isSellMode && slot === 'inventory' && !card.classList.contains('empty')) {
             card.addEventListener('click', handleSellItemClick);
        } else if (!isSellMode) {
            card.addEventListener('click', handleItemClick);
        }
    });

    document.getElementById('sell-toggle-button')?.addEventListener('click', () => {
        isSellMode = !isSellMode;
        renderEquipmentScreen();
    });

    document.getElementById('back-to-town-equip')?.addEventListener('click', () => {
        isSellMode = false; // Ensure sell mode is off when leaving screen
        renderTownScreen();
    });
}

function handleItemClick(event: MouseEvent) {
    const card = event.currentTarget as HTMLElement;
    const slot = card.dataset.slot as ItemSlot | 'inventory';
    const inventoryIndexStr = card.dataset.inventoryIndex;

    if (slot === 'inventory') {
        const index = parseInt(inventoryIndexStr || '0');
        const item = player.inventory[index];
        if (item) equipItem(item, index);
    } else { // Clicked on equipped item
        unequipItem(slot);
    }
}

function equipItem(item: EquipmentItem, inventoryIndex: number) {
    if (!item.classRestriction.includes(player.className)) {
        alert("이 직업은 착용할 수 없는 장비입니다.");
        return;
    }
    const currentItem = player.equipment[item.type];
    if (currentItem) {
        player.inventory.push(currentItem);
    }
    player.equipment[item.type] = item;
    player.inventory.splice(inventoryIndex, 1);
    
    const previousMaxHp = player.maxHp;
    recalculatePlayerStats();
    const hpGain = player.maxHp - previousMaxHp;
    player.hp += hpGain;
    player.hp = Math.min(player.hp, player.maxHp);
    
    renderEquipmentScreen();
}

function unequipItem(slot: ItemSlot) {
    const item = player.equipment[slot];
    if (item) {
        player.inventory.push(item);
        player.equipment[slot] = null;
        
        const previousMaxHp = player.maxHp;
        recalculatePlayerStats();
        const hpLoss = previousMaxHp - player.maxHp;
        player.hp -= hpLoss;
        if(player.hp > player.maxHp) player.hp = player.maxHp;
        if(player.hp <= 0) player.hp = 1;


        renderEquipmentScreen();
    }
}

function applyStatusEffect(target: Character, newEffect: StatusEffect) {
    const existingEffect = target.statusEffects.find(se => se.type === newEffect.type);
    if (existingEffect) {
        existingEffect.duration = Math.max(existingEffect.duration, newEffect.duration);
        existingEffect.potency = Math.max(existingEffect.potency, newEffect.potency);
    } else {
        target.statusEffects.push(newEffect);
    }
    const def = STATUS_EFFECT_DEFINITIONS[newEffect.type];
    addMessage(`${def.icon} ${target.name}이(가) [${def.name}] 효과를 받았다!`);
}

function processStatusEffects(character: Character): boolean {
    let isStunned = false;
    let totalDamage = 0;

    character.statusEffects = character.statusEffects.filter(se => {
        const def = STATUS_EFFECT_DEFINITIONS[se.type];
        if (se.type === 'stun') {
            isStunned = true;
        }
        if (se.type === 'poison') {
            let poisonDamage = se.potency;
            totalDamage += poisonDamage;
            addMessage(`${def.icon} [${def.name}] 효과로 ${character.name}이(가) ${poisonDamage}의 피해를 입었다!`);
        }
        if (se.type === 'burn') {
            totalDamage += se.potency;
            addMessage(`${def.icon} [${def.name}] 효과로 ${character.name}이(가) ${se.potency}의 피해를 입었다!`);
        }
        
        se.duration--;
        return se.duration > 0;
    });

    if (totalDamage > 0) {
        character.hp = Math.max(0, character.hp - totalDamage);
    }
    
    recalculatePlayerStats(); // Stats might change if weaken/vulnerable wears off
    return isStunned;
}

// --- Enhancement System ---

function getEnhancementCost(item: EquipmentItem): number {
    const rarityMultiplier = item.rarity === 'rare' ? 2.5 : (item.rarity === 'uncommon' ? 1.5 : 1);
    return Math.floor(50 * Math.pow(1.4, item.enhancementLevel) * rarityMultiplier);
}

function getEnhancementStoneCost(item: EquipmentItem): number {
    const rarityMultiplier = item.rarity === 'rare' ? 3 : (item.rarity === 'uncommon' ? 2 : 1);
    return Math.ceil( (2 + item.enhancementLevel) * rarityMultiplier / 2);
}

function getSuccessChance(level: number): number {
    if (level < 3) return 1.0;
    if (level < 5) return 0.9;
    if (level < 7) return 0.7;
    if (level < 9) return 0.5;
    if (level < 12) return 0.3;
    return 0.15;
}

function getStatIncrease(item: EquipmentItem): Partial<PlayerStats> {
    const rarityMultiplier = item.rarity === 'rare' ? 1.5 : (item.rarity === 'uncommon' ? 1.2 : 1);
    if (item.type === 'weapon') {
        return { attackPower: Math.ceil(2 * rarityMultiplier) };
    } else { // Armor
        return { defense: Math.ceil(1 * rarityMultiplier), maxHp: Math.ceil(5 * rarityMultiplier) };
    }
}

function renderEnhancementScreen() {
    currentScreen = GameScreen.ENHANCEMENT;

    root.innerHTML = `
        <div class="screen-container enhancement-screen">
            <h1>장비 강화</h1>
            <div class="gold-sp-display top-display">
                <p>💰 Gold: ${player.gold}</p>
                <p>💎 Stones: ${player.enhancementStones}</p>
            </div>
            <div class="enhancement-slots">
                <div class="enhancement-slot" data-slot="weapon">
                    <h3>무기</h3>
                    ${player.equipment.weapon ? createItemCardForEnhance(player.equipment.weapon) : '<div class="item-card empty">없음</div>'}
                </div>
                <div class="enhancement-slot" data-slot="armor">
                    <h3>방어구</h3>
                    ${player.equipment.armor ? createItemCardForEnhance(player.equipment.armor) : '<div class="item-card empty">없음</div>'}
                </div>
            </div>
            <div id="enhancement-details">
                <p>강화할 장비를 선택하세요.</p>
            </div>
            <button id="back-to-town" class="button">마을로 돌아가기</button>
        </div>
    `;

    document.querySelectorAll('.enhancement-slot').forEach(slot => {
        slot.addEventListener('click', () => {
            const slotType = slot.getAttribute('data-slot') as ItemSlot;
            renderEnhancementDetails(slotType);
        });
    });

    document.getElementById('back-to-town')?.addEventListener('click', renderTownScreen);
}

function createItemCardForEnhance(item: EquipmentItem) {
    const statsHtml = Object.entries(item.stats).map(([stat, value]) => {
        let statName = '';
        switch(stat) {
            case 'maxHp': statName = 'HP'; break;
            case 'attackPower': statName = 'ATK'; break;
            case 'defense': statName = 'DEF'; break;
            case 'critChance': statName = '치명타'; value = (value as number) * 100; return `${statName} +${value.toFixed(0)}%`;
            case 'evadeChance': statName = '회피'; value = (value as number) * 100; return `${statName} +${value.toFixed(0)}%`;
        }
        return `${statName} +${value}`;
    }).join(', ');

    return `
        <div class="item-card rarity-${item.rarity}">
            <p class="item-name">${getItemDisplayName(item)}</p>
            <p class="item-stats">${statsHtml}</p>
        </div>
    `;
}

function renderEnhancementDetails(slot: ItemSlot) {
    const detailsContainer = document.getElementById('enhancement-details');
    if (!detailsContainer) return;
    
    const item = player.equipment[slot];
    if (!item) {
        detailsContainer.innerHTML = `<p>강화할 장비가 없습니다.</p>`;
        return;
    }

    const goldCost = getEnhancementCost(item);
    const stoneCost = getEnhancementStoneCost(item);
    const successChance = getSuccessChance(item.enhancementLevel);
    const statIncrease = getStatIncrease(item);

    const nextStatsHtml = Object.entries(statIncrease).map(([stat, value]) => {
        let statName = '';
        switch(stat) {
            case 'maxHp': statName = '최대 HP'; break;
            case 'attackPower': statName = '공격력'; break;
            case 'defense': statName = '방어력'; break;
        }
        return `<span>${statName} +${value}</span>`;
    }).join('');

    const penaltyInfo = item.enhancementLevel >= 5
        ? `<p class="penalty-info">실패 시 30% 확률로 강화 단계가 하락합니다. 하락하지 않으면 비용의 50%를 돌려받습니다.</p>`
        : `<p class="penalty-info">실패 시 강화 비용만 소모됩니다.</p>`;

    detailsContainer.innerHTML = `
        <h3>${getItemDisplayName(item)} → +${item.enhancementLevel + 1}</h3>
        <div class="enhancement-info">
            <div class="info-row">
                <span>다음 레벨 효과:</span>
                <div class="next-stats">${nextStatsHtml}</div>
            </div>
            <div class="info-row">
                <span>강화 비용:</span>
                <span class="cost-display">${goldCost} G / ${stoneCost} 💎</span>
            </div>
            <div class="info-row">
                <span>성공 확률:</span>
                <span>${(successChance * 100).toFixed(0)}%</span>
            </div>
        </div>
        ${penaltyInfo}
        <button id="enhance-button" class="button" ${player.gold < goldCost || player.enhancementStones < stoneCost ? 'disabled' : ''}>강화</button>
    `;

    document.getElementById('enhance-button')?.addEventListener('click', () => handleEnhance(slot));
}

function handleEnhance(slot: ItemSlot) {
    const item = player.equipment[slot];
    if (!item) return;

    const goldCost = getEnhancementCost(item);
    const stoneCost = getEnhancementStoneCost(item);
    if (player.gold < goldCost || player.enhancementStones < stoneCost) return;

    player.gold -= goldCost;
    player.enhancementStones -= stoneCost;
    const successChance = getSuccessChance(item.enhancementLevel);

    if (Math.random() < successChance) {
        // Success
        item.enhancementLevel++;
        const statIncrease = getStatIncrease(item);
        Object.entries(statIncrease).forEach(([stat, value]) => {
            const key = stat as keyof PlayerStats;
            if (item.stats[key]) {
                (item.stats[key] as number) += value;
            } else {
                item.stats[key] = value;
            }
        });
        alert('✨ 강화 성공!');
    } else {
        // Failure
        if (item.enhancementLevel >= 5 && Math.random() < 0.3) {
            // Level down
            const statIncrease = getStatIncrease({ ...item, enhancementLevel: item.enhancementLevel - 1});
             Object.entries(statIncrease).forEach(([stat, value]) => {
                const key = stat as keyof PlayerStats;
                if (item.stats[key]) {
                    (item.stats[key] as number) -= value;
                }
            });
            item.enhancementLevel--;
            alert('📉 강화 실패... 강화 단계가 하락했습니다.');
        } else if (item.enhancementLevel >= 5) {
             // Refund
            const refund = Math.floor(goldCost / 2);
            player.gold += refund;
            alert(`🔥 강화 실패... 하지만 비용의 50% (${refund}G)를 돌려받았습니다.`);
        } else {
            alert('🔥 강화 실패...');
        }
    }
    
    const previousMaxHp = player.maxHp;
    recalculatePlayerStats();
    const hpChange = player.maxHp - previousMaxHp;
    player.hp += hpChange;
    player.hp = Math.min(player.hp, player.maxHp);
    if (player.hp <= 0) player.hp = 1;

    renderEnhancementScreen();
    renderEnhancementDetails(slot);
}

// --- Disenchant System ---

function getDisenchantYield(item: EquipmentItem): number {
    const rarityBonus = item.rarity === 'rare' ? 7 : item.rarity === 'uncommon' ? 3 : 1;
    const levelBonus = Math.floor(rarityBonus * item.enhancementLevel * 0.75);
    return rarityBonus + levelBonus;
}

function handleDisenchantItemClick(event: MouseEvent) {
    const card = event.currentTarget as HTMLElement;
    const inventoryIndexStr = card.dataset.inventoryIndex;
    if (inventoryIndexStr === undefined) return;

    const index = parseInt(inventoryIndexStr);
    const item = player.inventory[index];
    if (!item) return;

    const yieldAmount = getDisenchantYield(item);
    const confirmationMessage = `정말로 '${getItemDisplayName(item)}'을(를) 분해하여 강화석 💎${yieldAmount}개를 얻으시겠습니까? 이 행동은 되돌릴 수 없습니다.`;

    if (confirm(confirmationMessage)) {
        player.enhancementStones += yieldAmount;
        const disenchantedItemName = getItemDisplayName(item);
        player.inventory.splice(index, 1);
        addMessage(`🔮 ${disenchantedItemName}을(를) 분해하여 강화석 💎${yieldAmount}개를 얻었습니다.`);
        renderDisenchantScreen();
    }
}

function renderDisenchantScreen() {
    currentScreen = GameScreen.DISENCHANT;

    const createItemCardForDisenchant = (item: EquipmentItem, index: number) => {
        const statsHtml = Object.entries(item.stats).map(([stat, value]) => {
            let statName = '';
            switch(stat) {
                case 'maxHp': statName = 'HP'; break;
                case 'attackPower': statName = 'ATK'; break;
                case 'defense': statName = 'DEF'; break;
                case 'critChance': statName = '치명타'; value = (value as number) * 100; return `${statName} +${value.toFixed(0)}%`;
                case 'evadeChance': statName = '회피'; value = (value as number) * 100; return `${statName} +${value.toFixed(0)}%`;
            }
            return `${statName} +${value}`;
        }).join(', ');

        const yieldAmount = getDisenchantYield(item);
        const disenchantOverlayHtml = `<div class="disenchant-overlay">분해 시: 💎 ${yieldAmount}</div>`;

        return `
            <div class="item-card rarity-${item.rarity} disenchantable" data-inventory-index="${index}">
                <p class="item-name">${getItemDisplayName(item)}</p>
                <p class="item-stats">${statsHtml}</p>
                ${disenchantOverlayHtml}
            </div>
        `;
    };

    const inventoryHtml = player.inventory.map((item, index) => createItemCardForDisenchant(item, index)).join('');

    root.innerHTML = `
        <div class="screen-container disenchant-screen">
            <h1>장비 분해</h1>
            <div class="gold-sp-display top-display">
                <p>💰 Gold: ${player.gold}</p>
                <p>💎 Stones: ${player.enhancementStones}</p>
            </div>
            <h2>분해할 아이템을 선택하세요</h2>
            <div class="inventory-grid disenchant-mode">
                ${inventoryHtml || '<p>인벤토리가 비어있습니다.</p>'}
            </div>
            <button id="back-to-town" class="button">마을로 돌아가기</button>
        </div>
    `;

    document.querySelectorAll('.item-card.disenchantable').forEach(card => {
        card.addEventListener('click', handleDisenchantItemClick);
    });

    document.getElementById('back-to-town')?.addEventListener('click', renderTownScreen);
}


window.addEventListener('DOMContentLoaded', () => {
    createStartScreen();
});