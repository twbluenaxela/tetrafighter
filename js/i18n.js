// js/i18n.js — Internationalization support

const translations = {
    en: {
        title: 'TETRAFIGHTER',
        subtitle: 'Fight. Collect. Create Art.',
        startBtn: 'START BATTLE',
        controlsDesktop: 'WASD - Walk \u00a0|\u00a0 SHIFT - Sprint \u00a0|\u00a0 Mouse - Look Around \u00a0|\u00a0 Q/E - Rotate Body',
        controlsHint: 'Defeat enemies to collect their shapes and build your sculpture!',
        controlsMobile: 'Joystick - Move \u00a0|\u00a0 Swipe - Look \u00a0|\u00a0 Q/E Buttons - Rotate',
        blueTeam: 'Blue Team',
        redTeam: 'Red Team',
        fighters: 'Fighters: {0}',
        artShapes: 'Art: {0} shapes',
        gameOverTitle: 'GAME OVER',
        blueWinsTitle: 'BLUE TEAM WINS!',
        redWinsTitle: 'RED TEAM WINS!',
        drawTitle: 'DRAW!',
        blueWinsText: "Blue collected {0} shapes vs Red's {1}. Admire the art!",
        redWinsText: "Red collected {0} shapes vs Blue's {1}. Admire the art!",
        drawText: 'Both teams collected {0} shapes each!',
        showcaseHint: 'Camera is showcasing the art pieces...',
        restartBtn: 'PLAY AGAIN',
        blueReinforcement: 'Blue reinforcement!',
        switchedFighter: 'Switched to another fighter!',
        battleBegins: 'Battle begins! First to 15 shapes wins!',
        sprintBtn: 'SPRINT',
        // Lobby / Multiplayer
        namePlaceholder: 'Your Name',
        pveBtn: 'PLAY vs AI',
        pvpBtn: 'PLAY vs PLAYERS',
        pvpLobby: 'Multiplayer Lobby',
        createRoom: 'Create Room',
        joinRoom: 'Join Room',
        browseRooms: 'Browse',
        roomName: 'Room Name',
        visibility: 'Visibility',
        public: 'Public',
        private: 'Private',
        password: 'Password (optional)',
        yourTeam: 'Your Team',
        createRoomBtn: 'CREATE ROOM',
        inviteCode: 'Invite Code',
        joinRoomBtn: 'JOIN ROOM',
        joinRandomBtn: 'JOIN RANDOM ROOM',
        noRooms: 'No public rooms available',
        refreshBtn: 'REFRESH',
        backBtn: '\u2190 Back',
        codeLabel: 'Code:',
        copy: 'Copy',
        copyLink: 'Copy Invite Link',
        switchTeam: 'Switch Team',
        startGame: 'START GAME',
        leaveRoom: '\u2190 Leave Room',
        connectionFailed: 'Could not connect to server',
        enterPassword: 'Enter room password:',
    },
    'zh-TW': {
        title: 'TETRAFIGHTER',
        subtitle: '戰鬥。收集。創造藝術。',
        startBtn: '開始戰鬥',
        controlsDesktop: 'WASD - 移動 \u00a0|\u00a0 SHIFT - 衝刺 \u00a0|\u00a0 滑鼠 - 環顧 \u00a0|\u00a0 Q/E - 旋轉',
        controlsHint: '擊敗敵人來收集形狀，打造你的雕塑！',
        controlsMobile: '搖桿 - 移動 \u00a0|\u00a0 滑動 - 環顧 \u00a0|\u00a0 Q/E 按鈕 - 旋轉',
        blueTeam: '藍隊',
        redTeam: '紅隊',
        fighters: '戰士：{0}',
        artShapes: '藝術：{0} 個形狀',
        gameOverTitle: '遊戲結束',
        blueWinsTitle: '藍隊獲勝！',
        redWinsTitle: '紅隊獲勝！',
        drawTitle: '平手！',
        blueWinsText: '藍隊收集了 {0} 個形狀，紅隊 {1} 個。欣賞藝術吧！',
        redWinsText: '紅隊收集了 {0} 個形狀，藍隊 {1} 個。欣賞藝術吧！',
        drawText: '雙方各收集了 {0} 個形狀！',
        showcaseHint: '攝影機正在展示藝術作品⋯',
        restartBtn: '再玩一次',
        blueReinforcement: '藍隊增援！',
        switchedFighter: '已切換到另一位戰士！',
        battleBegins: '戰鬥開始！先收集 15 個形狀的隊伍獲勝！',
        sprintBtn: '衝刺',
        // Lobby / Multiplayer
        namePlaceholder: '你的名字',
        pveBtn: '對戰電腦',
        pvpBtn: '對戰玩家',
        pvpLobby: '多人大廳',
        createRoom: '建立房間',
        joinRoom: '加入房間',
        browseRooms: '瀏覽',
        roomName: '房間名稱',
        visibility: '可見性',
        public: '公開',
        private: '私人',
        password: '密碼（選填）',
        yourTeam: '你的隊伍',
        createRoomBtn: '建立房間',
        inviteCode: '邀請碼',
        joinRoomBtn: '加入房間',
        joinRandomBtn: '隨機加入房間',
        noRooms: '目前沒有公開房間',
        refreshBtn: '重新整理',
        backBtn: '\u2190 返回',
        codeLabel: '代碼：',
        copy: '複製',
        copyLink: '複製邀請連結',
        switchTeam: '切換隊伍',
        startGame: '開始遊戲',
        leaveRoom: '\u2190 離開房間',
        connectionFailed: '無法連接伺服器',
        enterPassword: '請輸入房間密碼：',
    },
};

let currentLang = localStorage.getItem('tetrafighter-lang') || 'en';

export function t(key, ...args) {
    let str = translations[currentLang]?.[key] ?? translations.en[key] ?? key;
    args.forEach((val, i) => {
        str = str.replace(`{${i}}`, val);
    });
    return str;
}

export function getLang() {
    return currentLang;
}

export function setLang(lang) {
    if (!translations[lang]) return;
    currentLang = lang;
    localStorage.setItem('tetrafighter-lang', lang);
    applyStaticTranslations();
}

export function toggleLang() {
    setLang(currentLang === 'en' ? 'zh-TW' : 'en');
}

export function applyStaticTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        el.textContent = t(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        el.placeholder = t(key);
    });
}
