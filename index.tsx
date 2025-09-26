/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

const root = document.getElementById('root') as HTMLDivElement;
if (!root) {
  throw new Error('Could not find root element');
}

// --- Type Definitions ---
interface SkillEffect {
    stat?: keyof PlayerStats | 'atkPercent' | 'defPercent' | 'hpPercent';
    value?: number;
    damageMultiplier?: number;
    buff?: { stat: keyof PlayerStats, value: number, duration: number, isPercent?: boolean };
    message: string;
}

interface Skill {
    id: string;
    name: string;
    description: (level: number) => string;
    type: 'ACTIVE' | 'PASSIVE';
    requiredLevel: number;
    dependencies: string[];
    maxLevel: number;
    cooldown?: number;
    effect: (level: number) => SkillEffect;
}

interface Character {
  name: string;
  hp: number;
  maxHp: number;
  attackPower: number;
  defense: number;
  emoji?: string;
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
}

interface PlayerCharacter extends Character, PlayerStats {
    className: keyof typeof CLASSES;
    weaponName: string;
    level: number;
    xp: number;
    xpToNextLevel: number;
    gold: number;
    potions: number;
    skillPoints: number;
    learnedSkills: { [key: string]: number }; // Skill ID -> Skill Level
    activeSkillCooldowns: { [key: string]: number };
    activeBuffs: { skillId: string, name: string, duration: number, effect: SkillEffect['buff'] }[];
    baseStats: PlayerStats;
    equipment: {
        weapon: EquipmentItem | null;
        armor: EquipmentItem | null;
    };
    inventory: EquipmentItem[];
}

enum GameScreen {
    START,
    DIFFICULTY_SELECTION,
    CLASS_SELECTION,
    TOWN,
    DUNGEON,
    SHOP,
    SKILL_TREE,
    TRAINING_GROUND,
    EQUIPMENT,
}

// --- Game Constants ---
const CRIT_MULTIPLIER = 1.5;
const POTION_HEAL_PERCENT = 0.6;
const POTION_COST = 20;
const DEFEAT_GOLD_PENALTY = 0.1;

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

const SKILLS: { [key: string]: Skill[] } = {
    '전사': [
        { id: 'w_toughness', name: '견고함', maxLevel: 5, type: 'PASSIVE', requiredLevel: 2, dependencies: [], 
          description: level => `최대 체력이 레벨당 25씩 증가합니다. (현재: +${level*25})`,
          effect: level => ({ stat: 'maxHp', value: 25 * level, message: `견고함 Lv.${level} 효과로 최대 체력이 증가했다.` }) },
        { id: 'w_power_strike', name: '강타', maxLevel: 5, type: 'ACTIVE', requiredLevel: 3, dependencies: [], cooldown: 3,
          description: level => `공격력의 ${170 + 10 * level}% 피해를 입힙니다.`,
          effect: level => ({ damageMultiplier: 1.7 + 0.1 * level, message: '강타로 강력한 일격을 날렸다!' }) },
        { id: 'w_armor_up', name: '갑옷 숙련', maxLevel: 5, type: 'PASSIVE', requiredLevel: 4, dependencies: ['w_toughness'],
          description: level => `방어력이 레벨당 2씩 증가합니다. (현재: +${level*2})`,
          effect: level => ({ stat: 'defense', value: 2 * level, message: '방어력이 증가했다.' }) },
        { id: 'w_iron_will', name: '철벽 방어', maxLevel: 3, type: 'ACTIVE', requiredLevel: 5, dependencies: ['w_power_strike'], cooldown: 5,
          description: level => `3턴 동안 방어력이 ${40 + 10*level}% 증가합니다.`,
          effect: level => ({ buff: { stat: 'defense', value: 0.4 + 0.1 * level, duration: 3, isPercent: true }, message: '철벽 방어로 몸을 굳건히 했다!' }) },
    ],
    '마법사': [
        { id: 'm_knowledge', name: '지식의 흐름', maxLevel: 5, type: 'PASSIVE', requiredLevel: 2, dependencies: [],
          description: level => `공격력이 레벨당 8%씩 증가합니다. (현재: +${level*8}%)`,
          effect: level => ({ stat: 'atkPercent', value: 0.08 * level, message: '공격력이 증가했다.' }) },
        { id: 'm_fireball', name: '화염구', maxLevel: 5, type: 'ACTIVE', requiredLevel: 3, dependencies: [], cooldown: 3,
          description: level => `공격력의 ${180 + 20 * level}% 피해를 입힙니다.`,
          effect: level => ({ damageMultiplier: 1.8 + 0.2 * level, message: '거대한 화염구가 몬스터를 덮쳤다!' }) },
        { id: 'm_focus', name: '정신 집중', maxLevel: 5, type: 'PASSIVE', requiredLevel: 4, dependencies: ['m_knowledge'],
          description: level => `치명타 확률이 레벨당 3%씩 증가합니다. (현재: +${level*3}%)`,
          effect: level => ({ stat: 'critChance', value: 0.03 * level, message: '치명타 확률이 증가했다.' }) },
        { id: 'm_ice_lance', name: '얼음 창', maxLevel: 3, type: 'ACTIVE', requiredLevel: 5, dependencies: ['m_fireball'], cooldown: 5,
          description: level => `공격력의 ${220 + 30 * level}% 피해를 입힙니다.`,
          effect: level => ({ damageMultiplier: 2.2 + 0.3 * level, message: '날카로운 얼음 창이 몬스터를 꿰뚫었다!' }) },
    ],
    '도적': [
        { id: 'r_agility', name: '민첩함', maxLevel: 5, type: 'PASSIVE', requiredLevel: 2, dependencies: [],
          description: level => `회피율이 레벨당 3%씩 증가합니다. (현재: +${level*3}%)`,
          effect: level => ({ stat: 'evadeChance', value: 0.03 * level, message: '회피율이 증가했다.' }) },
        { id: 'r_shadow_strike', name: '그림자 습격', maxLevel: 5, type: 'ACTIVE', requiredLevel: 3, dependencies: [], cooldown: 4,
          description: level => `치명타 확률이 30% 높은 ${140 + 10 * level}% 피해를 입힙니다.`,
          effect: level => ({ damageMultiplier: 1.4 + 0.1 * level, message: '그림자 속에서 적의 급소를 노렸다!' }) },
        { id: 'r_lethality', name: '치명적인 독', maxLevel: 5, type: 'PASSIVE', requiredLevel: 4, dependencies: ['r_agility'],
          description: level => `치명타 확률이 레벨당 2%씩 추가로 증가합니다. (현재: +${level*2}%)`,
          effect: level => ({ stat: 'critChance', value: 0.02 * level, message: '치명타 확률이 증가했다.' }) },
        { id: 'r_vanish', name: '연막', maxLevel: 3, type: 'ACTIVE', requiredLevel: 5, dependencies: ['r_shadow_strike'], cooldown: 5,
          description: level => `2턴 동안 회피율이 ${30 + 10*level}% 증가합니다.`,
          effect: level => ({ buff: { stat: 'evadeChance', value: 0.3 + 0.1*level, duration: 2 }, message: '연막을 터뜨려 모습을 감췄다!' }) },
    ],
};

const ITEM_DATABASE: EquipmentItem[] = [
    // Common
    { id: 101, name: "녹슨 검", type: 'weapon', stats: { attackPower: 2 }, rarity: 'common', cost: 20 },
    { id: 102, name: "해진 로브", type: 'armor', stats: { maxHp: 10 }, rarity: 'common', cost: 20 },
    { id: 103, name: "가죽 갑옷", type: 'armor', stats: { defense: 1 }, rarity: 'common', cost: 25 },
    { id: 104, name: "나무 지팡이", type: 'weapon', stats: { attackPower: 3 }, rarity: 'common', cost: 25 },
    { id: 105, name: "작은 단검", type: 'weapon', stats: { critChance: 0.02 }, rarity: 'common', cost: 30 },

    // Uncommon
    { id: 201, name: "강철 검", type: 'weapon', stats: { attackPower: 5 }, rarity: 'uncommon', cost: 80 },
    { id: 202, name: "마법사의 로브", type: 'armor', stats: { maxHp: 20, attackPower: 2 }, rarity: 'uncommon', cost: 90 },
    { id: 203, name: "사슬 갑옷", type: 'armor', stats: { defense: 3, maxHp: 15 }, rarity: 'uncommon', cost: 100 },
    { id: 204, name: "보석 박힌 지팡이", type: 'weapon', stats: { attackPower: 6 }, rarity: 'uncommon', cost: 100 },
    { id: 205, name: "암살자의 단검", type: 'weapon', stats: { attackPower: 3, critChance: 0.05 }, rarity: 'uncommon', cost: 110 },
    
    // Rare
    { id: 301, name: "룬 블레이드", type: 'weapon', stats: { attackPower: 8, critChance: 0.03 }, rarity: 'rare', cost: 250 },
    { id: 302, name: "대마법사의 로브", type: 'armor', stats: { maxHp: 30, attackPower: 5, defense: 1 }, rarity: 'rare', cost: 300 },
    { id: 303, name: "기사의 갑옷", type: 'armor', stats: { defense: 5, maxHp: 40 }, rarity: 'rare', cost: 320 },
];


let player: PlayerCharacter;
let monster: Character;
let hpTrainingCost: number;
let atkTrainingCost: number;
let defTrainingCost: number;
let messageLog: string[];
let currentScreen: GameScreen;
let currentDifficulty: Difficulty;
let dungeonLevel: number;
let dungeonFloor: number;


const monsterList = [
    { name: '슬라임', emoji: '💧', baseHp: 20, baseAttack: 5, xp: 25, gold: 5, lootTable: [102, 105] },
    { name: '고블린', emoji: '👺', baseHp: 30, baseAttack: 7, xp: 40, gold: 10, lootTable: [101, 103, 105] },
    { name: '오크', emoji: '👹', baseHp: 45, baseAttack: 11, xp: 60, gold: 15, lootTable: [101, 103, 201] },
    { name: '스켈레톤', emoji: '💀', baseHp: 65, baseAttack: 14, xp: 85, gold: 25, lootTable: [201, 203] },
];

const bossList = [
    { name: '동굴 트롤', emoji: '🗿', baseHp: 100, baseAttack: 18, xp: 200, gold: 100, lootTable: [201, 203, 205] },
    { name: '거대 골렘', emoji: '🤖', baseHp: 150, baseAttack: 23, xp: 300, gold: 150, lootTable: [202, 204, 303] },
    { name: '흑기사', emoji: '♞', baseHp: 200, baseAttack: 28, xp: 450, gold: 220, lootTable: [301, 303] },
    { name: '드래곤', emoji: '🐲', baseHp: 270, baseAttack: 34, xp: 600, gold: 300, lootTable: [301, 302] },
];

function createStartScreen() {
  currentScreen = GameScreen.START;
  root.innerHTML = `
    <div class="screen-container">
      <h1>간단 RPG: 스킬 트리</h1>
      <p>직업을 선택하고, 스킬을 배워 던전을 정복하세요!</p>
      <button id="start-button" class="button">게임 시작</button>
    </div>
  `;
  document.getElementById('start-button')?.addEventListener('click', createDifficultySelectionScreen);
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
                    <p>높은 체력과 방어력. 안정적인 전투를 이끌어갑니다.</p>
                </button>
                <button class="class-card" data-class="마법사">
                    <h2>마법사 🔥</h2>
                    <p>강력한 공격 마법을 사용하지만, 체력이 약합니다.</p>
                </button>
                <button class="class-card" data-class="도적">
                    <h2>도적 💨</h2>
                    <p>높은 치명타와 회피율로 변수를 창출합니다.</p>
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

function initializeGame(chosenClass: keyof typeof CLASSES, playerName: string) {
  hpTrainingCost = 100;
  atkTrainingCost = 100;
  defTrainingCost = 100;
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
    potions: difficultySettings.startPotions,
    skillPoints: 0,
    learnedSkills: {},
    activeSkillCooldowns: {},
    activeBuffs: [],
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
    Object.assign(p, p.baseStats);
    
    let atkPercentBonus = 0;
    let defPercentBonus = 0;
    let hpPercentBonus = 0;

    // Passive Skills
    Object.entries(p.learnedSkills).forEach(([skillId, level]) => {
        const skill = SKILLS[p.className].find(s => s.id === skillId);
        if (!skill || skill.type !== 'PASSIVE' || level === 0) return;
        const effect = skill.effect(level);
        switch (effect.stat) {
            case 'atkPercent': atkPercentBonus += effect.value ?? 0; break;
            case 'defPercent': defPercentBonus += effect.value ?? 0; break;
            case 'hpPercent': hpPercentBonus += effect.value ?? 0; break;
            default: if (effect.stat && effect.value) p[effect.stat as keyof PlayerStats] += effect.value;
        }
    });

    // Equipment
    Object.values(p.equipment).forEach(item => {
        if (item) {
            Object.entries(item.stats).forEach(([stat, value]) => {
                if (stat in p) {
                    (p[stat as keyof PlayerStats] as number) += value;
                }
            });
        }
    });

    // Percent Bonuses
    p.maxHp = Math.floor(p.maxHp * (1 + hpPercentBonus));
    p.attackPower = Math.floor(p.attackPower * (1 + atkPercentBonus));
    p.defense = Math.floor(p.defense * (1 + defPercentBonus));

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
             p[b.stat] += b.value;
        }
    });
    
    p.attackPower = Math.floor(p.attackPower * (1 + buffAtkPercent));
    p.defense = Math.floor(p.defense * (1 + buffDefPercent));

    p.hp = Math.min(p.hp, p.maxHp);
}

function getFloorsForDungeon(level: number): number {
    return 3 + Math.floor((level - 1) / 3);
}

function renderTownScreen() {
    currentScreen = GameScreen.TOWN;
    root.innerHTML = `
        <div class="screen-container town-screen">
            <h1>마을</h1>
            <p>현재 도전할 던전: ${dungeonLevel} 레벨</p>
            ${createCharacterCard(player, true)}
            <div id="action-buttons" class="town-actions">
                <button id="dungeon-button" class="button">던전 입장</button>
                <button id="shop-button" class="button">상점</button>
                <button id="equipment-button" class="button">장비</button>
                <button id="training-button" class="button">단련장</button>
                <button id="skill-tree-button" class="button">스킬 단련장</button>
            </div>
        </div>
    `;
    document.getElementById('dungeon-button')?.addEventListener('click', startDungeon);
    document.getElementById('shop-button')?.addEventListener('click', renderShopScreen);
    document.getElementById('equipment-button')?.addEventListener('click', renderEquipmentScreen);
    document.getElementById('training-button')?.addEventListener('click', renderTrainingGroundScreen);
    document.getElementById('skill-tree-button')?.addEventListener('click', renderSkillTreeScreen);
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
    };
}

function createCharacterCard(character: PlayerCharacter | Character, isPlayer: boolean) {
    const hpPercentage = (character.hp / character.maxHp) * 100;

    if (isPlayer && 'className' in character) {
        const p = character as PlayerCharacter;
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
                <span>⚔️ ${p.equipment.weapon?.name || '맨손'}</span>
                <span>🛡️ ${p.equipment.armor?.name || '맨몸'}</span>
            </div>
        `;

        return `
            <div class="character-card player-card">
                <div class="player-header">
                    <h2>${p.name} <span class="player-class">(${p.className} ${CLASSES[p.className].emoji} Lv.${p.level})</span></h2>
                    <div class="gold-sp-display">
                        <p>💰 Gold: ${p.gold}</p>
                        <p>✨ SP: ${p.skillPoints}</p>
                    </div>
                </div>
                 ${dungeonInfo}
                <div class="hp-bar-container">
                    <div class="hp-bar" style="width: ${hpPercentage}%;"></div>
                </div>
                <p>HP: ${p.hp} / ${p.maxHp}</p>
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
        </div>
    `;
}

function renderDungeonScreen() {
    if (currentScreen !== GameScreen.TOWN && currentScreen !== GameScreen.DUNGEON) return;
    currentScreen = GameScreen.DUNGEON;

    const learnedActiveSkills = Object.keys(player.learnedSkills)
        .map(id => SKILLS[player.className].find(s => s.id === id))
        .filter(s => s && s.type === 'ACTIVE' && (player.learnedSkills[s.id] || 0) > 0);

    const skillButtons = learnedActiveSkills.map(skill => {
        if (!skill) return '';
        const cooldown = player.activeSkillCooldowns[skill.id] || 0;
        const disabled = cooldown > 0;
        return `<button data-action="skill" data-skill-id="${skill.id}" class="button skill-button" ${disabled ? 'disabled' : ''}>${skill.name} ${disabled ? `(${cooldown})` : ''}</button>`;
    }).join('');

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
            <button data-action="escape" class="button">탈출</button>
            ${skillButtons}
        </div>
    `;

    const logContainer = document.getElementById('message-log');
    if (logContainer) logContainer.scrollTop = logContainer.scrollHeight;

    document.getElementById('action-buttons')?.addEventListener('click', handleDungeonAction);
}

function handleDungeonAction(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const button = target.closest('button');
    if (!button) return;

    const action = button.dataset.action;
    switch (action) {
        case 'attack':
            handleAttack();
            break;
        case 'potion':
            handleUsePotion();
            break;
        case 'escape':
            handleEscape();
            break;
        case 'skill':
            const skillId = button.dataset.skillId;
            if (skillId) handleUseSkill(skillId);
            break;
    }
}


function handleEscape() {
    if (confirm("정말로 던전에서 탈출하시겠습니까? 이번 탐험에서 얻은 보상을 모두 잃게 됩니다.")) {
        player.hp = player.maxHp;
        player.activeBuffs = [];
        player.activeBuffs.forEach(buff => buff.duration = 0);
        handlePlayerDefeat(true); // isEscaping = true
    }
}

function addMessage(message: string) {
    messageLog.unshift(message);
    if (messageLog.length > 5) messageLog.pop();
}

function executePlayerTurnAction(action: () => void, consumesTurn: boolean = true) {
    if (currentScreen !== GameScreen.DUNGEON) return;

    if (consumesTurn) {
        Object.keys(player.activeSkillCooldowns).forEach(id => {
            if (player.activeSkillCooldowns[id] > 0) player.activeSkillCooldowns[id]--;
        });
        player.activeBuffs = player.activeBuffs.map(buff => ({ ...buff, duration: buff.duration - 1 })).filter(buff => buff.duration > 0);
        recalculatePlayerStats();
    }

    action();

    if (monster.hp <= 0) {
        monsterDefeated();
    } else if (player.hp > 0 && consumesTurn) {
        monsterAttack();
    } else {
        renderDungeonScreen();
    }
}

function handleAttack() {
    executePlayerTurnAction(() => {
        let playerDamage = Math.floor(player.attackPower + (Math.random() * 5 - 2));
        if (Math.random() < player.critChance) {
            playerDamage = Math.floor(playerDamage * CRIT_MULTIPLIER);
            addMessage(`💥 치명타! ${player.name}이(가) ${monster.name}에게 ${playerDamage}의 데미지를 입혔다!`);
        } else {
            addMessage(`⚔️ ${player.name}이(가) ${monster.name}에게 ${playerDamage}의 데미지를 입혔다.`);
        }
        monster.hp = Math.max(0, monster.hp - playerDamage);
    });
}

function handleUseSkill(skillId: string) {
    const skill = SKILLS[player.className].find(s => s.id === skillId);
    if (!skill || (player.activeSkillCooldowns[skillId] || 0) > 0) return;
    
    executePlayerTurnAction(() => {
        const skillLevel = player.learnedSkills[skillId];
        const effect = skill.effect(skillLevel);
        
        addMessage(effect.message);
        player.activeSkillCooldowns[skill.id] = skill.cooldown ?? 0;

        if (effect.damageMultiplier) {
            let damage = player.attackPower * effect.damageMultiplier;
            let critChance = player.critChance;
            if (skill.id === 'r_shadow_strike') critChance += 0.3;
            if (Math.random() < critChance) {
                damage = Math.floor(damage * CRIT_MULTIPLIER);
                addMessage(`💥 치명타! ${damage}의 피해!`);
            }
            monster.hp = Math.max(0, monster.hp - Math.floor(damage));
        }

        if (effect.buff) {
            player.activeBuffs.push({ skillId: skill.id, name: skill.name, duration: effect.buff.duration + 1, effect: effect.buff });
            recalculatePlayerStats();
        }
    });
}

function handleUsePotion() {
    if (player.potions <= 0) return;
    executePlayerTurnAction(() => {
        player.potions--;
        const healAmount = Math.floor(player.maxHp * POTION_HEAL_PERCENT);
        player.hp = Math.min(player.maxHp, player.hp + healAmount);
        addMessage(`🧪 물약을 사용해 HP를 ${healAmount}만큼 회복했다!`);
    }, false); // Potion does not consume a turn
}

function monsterAttack() {
    if (Math.random() < player.evadeChance) {
        addMessage(`🍃 ${player.name}이(가) 공격을 회피했다!`);
    } else {
        let monsterDamage = Math.floor(monster.attackPower + (Math.random() * 4 - 2));
        if (Math.random() < 0.1) { // Monster Crit Chance
            monsterDamage = Math.floor(monsterDamage * CRIT_MULTIPLIER);
            addMessage(`💢 치명타! ${monster.name}이(가) ${monsterDamage}의 데미지를 입혔다!`);
        }
        const finalDamage = Math.max(1, monsterDamage - player.defense);
        addMessage(`🛡️ ${monster.name}의 공격! ${player.name}은(는) ${finalDamage}의 피해를 입었다.`);
        player.hp = Math.max(0, player.hp - finalDamage);
    }

    if (player.hp <= 0) {
        handlePlayerDefeat();
    } else {
        renderDungeonScreen();
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
    return ITEM_DATABASE.find(i => i.id === lootId) || null;
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
    player.skillPoints++;
    player.xpToNextLevel = Math.floor(player.xpToNextLevel * 1.5);
    addMessage(`✨ 레벨업! 레벨 ${player.level}이 되었다! 스킬 포인트(SP)를 획득했다!`);
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
                <button id="skill-tree-button" class="button">스킬 배우기 (SP: ${player.skillPoints})</button>
                <button id="return-town-button" class="button">마을로 돌아가기</button>
            </div>
        </div>
    `;
    dungeonLevel++;
    document.getElementById('skill-tree-button')?.addEventListener('click', renderSkillTreeScreen);
    document.getElementById('return-town-button')?.addEventListener('click', renderTownScreen);
}

function renderShopScreen() {
    currentScreen = GameScreen.SHOP;
    const itemsForSale = [
        ...ITEM_DATABASE.filter(i => i.rarity === 'common' && i.cost < 50),
        ...ITEM_DATABASE.filter(i => i.rarity === 'uncommon' && dungeonLevel >= 2).slice(0, 2),
        ...ITEM_DATABASE.filter(i => i.rarity === 'rare' && dungeonLevel >= 4).slice(0, 1),
    ].slice(0, 4); // Show a limited selection

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
                    <button class="button" id="buy-potion" ${player.gold < POTION_COST ? 'disabled' : ''}>${POTION_COST} G</button>
                </div>
                ${itemsHtml}
            </div>
            <button id="back-to-town" class="button">마을로 돌아가기</button>
        </div>
    `;
    document.getElementById('buy-potion')?.addEventListener('click', () => {
        if (player.gold >= POTION_COST) {
            player.gold -= POTION_COST;
            player.potions++;
            renderShopScreen();
        }
    });
    document.querySelectorAll('.buy-item-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const itemId = parseInt((e.currentTarget as HTMLElement).dataset.itemId || '0');
            const item = ITEM_DATABASE.find(i => i.id === itemId);
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
    root.innerHTML = `
        <div class="screen-container shop-container">
            <h1>단련장</h1>
            <p class="gold-display">💰 Gold: ${player.gold}</p>
            <div class="shop-items">
                <div class="shop-item">
                    <span>❤️ 최대 생명력 단련 (+10 HP)</span>
                    <button class="button" id="train-hp" ${player.gold < hpTrainingCost ? 'disabled' : ''}>${hpTrainingCost} G</button>
                </div>
                <div class="shop-item">
                    <span>⚔️ 공격력 단련 (+4 ATK)</span>
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
            player.baseStats.attackPower += 4;
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

function handlePlayerDefeat(isEscaping = false) {
    if (!isEscaping) {
        const goldLost = Math.floor(player.gold * DEFEAT_GOLD_PENALTY);
        player.gold -= goldLost;
        messageLog = [`골드 ${goldLost}를 잃었다...`, '정신을 차려보니 마을이었다.', `던전 ${dungeonFloor}층에서 쓰러졌다.`];
    } else {
        messageLog = ['무사히 마을로 도망쳤다...'];
    }
    
    player.activeBuffs = [];
    recalculatePlayerStats();
    player.hp = player.maxHp;
    renderTownScreen();
}


function renderSkillTreeScreen() {
    currentScreen = GameScreen.SKILL_TREE;
    const classSkills = SKILLS[player.className];

    const skillTiers: { [level: number]: Skill[] } = {};
    classSkills.forEach(skill => {
        if (!skillTiers[skill.requiredLevel]) {
            skillTiers[skill.requiredLevel] = [];
        }
        skillTiers[skill.requiredLevel].push(skill);
    });

    const tierHtml = Object.keys(skillTiers).sort((a,b) => parseInt(a) - parseInt(b)).map(level => {
        const skillsInTier = skillTiers[parseInt(level)];
        const skillNodes = skillsInTier.map(skill => {
            const currentLevel = player.learnedSkills[skill.id] || 0;
            const isMaxLevel = currentLevel === skill.maxLevel;
            const dependenciesMet = skill.dependencies.every(dep => (player.learnedSkills[dep] || 0) > 0);
            
            const canLearn = player.skillPoints > 0 && 
                             player.level >= skill.requiredLevel && 
                             dependenciesMet &&
                             !isMaxLevel;
            
            let statusClass = 'locked';
            if (currentLevel > 0) statusClass = 'learned';
            if (canLearn) statusClass = 'learnable';
            if (isMaxLevel) statusClass = 'maxed';

            return `
                <div class="skill-node ${statusClass}" data-skill-id="${skill.id}" title="${skill.description(currentLevel)}">
                    <p class="skill-name">${skill.name}</p>
                    <p class="skill-level">Lv. ${currentLevel}/${skill.maxLevel}</p>
                    <p class="skill-type">${skill.type === 'ACTIVE' ? '액티브' : '패시브'}</p>
                </div>
            `;
        }).join('');
        return `<div class="skill-tier"><h3>Lv. ${level} 요구</h3><div class="skill-tier-nodes">${skillNodes}</div></div>`;
    }).join('');

    root.innerHTML = `
        <div class="screen-container skill-tree-container">
            <div class="skill-tree-header">
                <h1>스킬 단련장</h1>
                <p>보유 스킬 포인트(SP): ${player.skillPoints}</p>
            </div>
            <div class="skill-tree">
                ${tierHtml}
                <svg class="skill-tree-lines"></svg>
            </div>
            <button id="back-to-town-skill" class="button">돌아가기</button>
        </div>
    `;
    
    setTimeout(() => drawSkillTreeLines(), 0);

    document.querySelectorAll('.skill-node.learnable, .skill-node.learned').forEach(node => {
        node.addEventListener('click', (e) => {
            const skillId = (e.currentTarget as HTMLElement).dataset.skillId;
            if (skillId) learnOrLevelUpSkill(skillId);
        });
    });
    
    document.getElementById('back-to-town-skill')?.addEventListener('click', renderTownScreen);
}

function drawSkillTreeLines() {
    const svg = document.querySelector('.skill-tree-lines') as SVGElement | null;
    const tree = document.querySelector('.skill-tree') as HTMLElement | null;
    if (!svg || !tree) return;
    svg.innerHTML = '';
    const treeRect = tree.getBoundingClientRect();

    SKILLS[player.className].forEach(skill => {
        skill.dependencies.forEach(depId => {
            const fromNode = document.querySelector(`[data-skill-id="${depId}"]`) as HTMLElement | null;
            const toNode = document.querySelector(`[data-skill-id="${skill.id}"]`) as HTMLElement | null;
            if (fromNode && toNode) {
                const fromRect = fromNode.getBoundingClientRect();
                const toRect = toNode.getBoundingClientRect();

                const x1 = fromRect.left + fromRect.width / 2 - treeRect.left;
                const y1 = fromRect.top + fromRect.height - treeRect.top;
                const x2 = toRect.left + toRect.width / 2 - treeRect.left;
                const y2 = toRect.top - treeRect.top;
                
                const isLearned = (player.learnedSkills[depId] || 0) > 0;
                
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', String(x1));
                line.setAttribute('y1', String(y1));
                line.setAttribute('x2', String(x2));
                line.setAttribute('y2', String(y2));
                line.setAttribute('stroke', isLearned ? 'var(--skill-learnable-bg)' : 'var(--border-color)');
                line.setAttribute('stroke-width', '3');
                svg.appendChild(line);
            }
        });
    });
}

function learnOrLevelUpSkill(skillId: string) {
    const skill = SKILLS[player.className].find(s => s.id === skillId);
    if (!skill) return;
    
    const currentLevel = player.learnedSkills[skillId] || 0;
    if (currentLevel >= skill.maxLevel) {
        alert("이미 마스터한 스킬입니다.");
        return;
    }

    if (player.skillPoints <= 0) {
        alert("스킬 포인트가 부족합니다.");
        return;
    }
    
    const dependenciesMet = skill.dependencies.every(dep => (player.learnedSkills[dep] || 0) > 0);
    if (!dependenciesMet) {
        alert("선행 스킬을 먼저 배워야 합니다.");
        return;
    }
    
    if (player.level < skill.requiredLevel) {
        alert(`이 스킬을 배우려면 레벨 ${skill.requiredLevel}이 필요합니다.`);
        return;
    }

    const nextLevel = currentLevel + 1;
    const confirmationMessage = `스킬 [${skill.name}]을(를) Lv.${nextLevel}로 올리시겠습니까?\n\n- 설명: ${skill.description(nextLevel)}\n- 필요 SP: 1`;
    if (!confirm(confirmationMessage)) {
        return;
    }

    player.skillPoints--;
    player.learnedSkills[skillId] = nextLevel;

    if (nextLevel === 1) {
        addMessage(`💡 스킬 [${skill.name}]을(를) 배웠다!`);
    } else {
        addMessage(`💡 스킬 [${skill.name}]이(가) Lv.${nextLevel}이 되었다!`);
    }

    if(skill.type === 'PASSIVE') {
        const previousMaxHp = player.maxHp;
        recalculatePlayerStats();
        const hpGain = player.maxHp - previousMaxHp;
        player.hp += hpGain;
        player.hp = Math.min(player.hp, player.maxHp);
    }

    renderSkillTreeScreen();
}

function renderEquipmentScreen() {
    currentScreen = GameScreen.EQUIPMENT;

    const createItemCard = (item: EquipmentItem | null, slot: ItemSlot | 'inventory', index?: number) => {
        if (!item) {
            return `<div class="item-card empty" data-slot="${slot}">비어있음</div>`;
        }
        const statsHtml = Object.entries(item.stats).map(([stat, value]) => {
            let statName = '';
            switch(stat) {
                case 'maxHp': statName = 'HP'; break;
                case 'attackPower': statName = 'ATK'; break;
                case 'defense': statName = 'DEF'; break;
                case 'critChance': statName = '치명타'; value *= 100; return `${statName} +${value.toFixed(0)}%`;
                case 'evadeChance': statName = '회피'; value *= 100; return `${statName} +${value.toFixed(0)}%`;
            }
            return `${statName} +${value}`;
        }).join(', ');
        
        return `
            <div class="item-card rarity-${item.rarity}" data-slot="${slot}" data-item-id="${item.id}" ${index !== undefined ? `data-inventory-index="${index}"` : ''}>
                <p class="item-name">${item.name}</p>
                <p class="item-stats">${statsHtml}</p>
            </div>
        `;
    };

    const inventoryHtml = player.inventory.map((item, index) => createItemCard(item, 'inventory', index)).join('');

    root.innerHTML = `
        <div class="screen-container equipment-screen">
            <h1>장비</h1>
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
            <h2>인벤토리</h2>
            <div class="inventory-grid">
                ${inventoryHtml || '<p>인벤토리가 비어있습니다.</p>'}
            </div>
            <button id="back-to-town-equip" class="button">마을로 돌아가기</button>
        </div>
    `;
    
    document.querySelectorAll('.item-card').forEach(card => {
        card.addEventListener('click', handleItemClick);
    });
    document.getElementById('back-to-town-equip')?.addEventListener('click', renderTownScreen);
}

function handleItemClick(event: MouseEvent) {
    const card = event.currentTarget as HTMLElement;
    const slot = card.dataset.slot as ItemSlot | 'inventory';
    const itemId = parseInt(card.dataset.itemId || '0');
    
    if (!itemId) return; // Clicked on empty slot

    if (slot === 'inventory') {
        const index = parseInt(card.dataset.inventoryIndex || '0');
        const item = player.inventory[index];
        if (item) equipItem(item, index);
    } else { // Clicked on equipped item
        unequipItem(slot);
    }
}

function equipItem(item: EquipmentItem, inventoryIndex: number) {
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
        if(player.hp > player.maxHp) player.hp = player.maxHp;

        renderEquipmentScreen();
    }
}


createStartScreen();