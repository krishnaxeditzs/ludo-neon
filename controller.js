/*=========================================
        XBOX BUTTON MAP
=========================================*/

const BTN = {

    A: 0,
    B: 1,
    X: 2,
    Y: 3,

    LB: 4,
    RB: 5,

    LT: 6,
    RT: 7,

    BACK: 8,
    START: 9,

    LS: 10,
    RS: 11,

    UP: 12,
    DOWN: 13,
    LEFT: 14,
    RIGHT: 15

};

/*=========================================
        DEBUG
=========================================*/

const Debug = {

    alwaysSix: false

};

/*=========================================
        SETUP MENU
=========================================*/

let setupFocus = 0;
let settingsFocus = 0;
let pauseFocus = 0;
let settingsSource = "setup";

const setupControls = [

    "p-red",
    "p-green",
    "p-blue",
    "p-yellow",

    "open-settings-btn",

    "enter-arena"

];

const settingsControls = [

    "turn-aura-setting",
    "trail-setting",
    "particles-setting",
    "capture-setting",
    "winner-setting",

    "master-volume",
    "music-volume",
    "effects-volume",

    "bg-music-setting",
    "sound-setting",

    "close-settings-btn"

];

function updateSetupFocus(){

    setupControls.forEach(id=>{

        document
            .getElementById(id)
            ?.classList.remove("controller-focus");

    });

    document
        .getElementById(setupControls[setupFocus])
        ?.classList.add("controller-focus");

}

function updateSettingsFocus() {

    settingsControls.forEach(id => {

        document
            .getElementById(id)
            ?.classList.remove("controller-focus");

    });

    const element = document.getElementById(
        settingsControls[settingsFocus]
    );

    if (element) {

        element.classList.add("controller-focus");

        element.scrollIntoView({
            behavior: "auto",
            block: "center"
        });

    }

}

/*=========================================
        CONTROLLER STATE
=========================================*/

let controllerEnabled = true;

let selectableTokens = [];

let selectedTokenIndex = 0;



/*=========================================
    LUDO NEON
    CONTROLLER ENGINE V1
=========================================*/
//GLOBALS
let gamepad = null;
let previousButtons = [];
let lastButtonTime = 0;

const BUTTON_COOLDOWN = 150; // milliseconds

let previousAxes = [0, 0];
let heldDirection = null;
let firstRepeat = true;
let nextRepeatTime = 0;

const FIRST_REPEAT_DELAY = 200;
const REPEAT_DELAY = 100;

window.addEventListener("gamepadconnected", (e)=>{

    gamepad = e.gamepad;
    showControllerToast(
    "Controller Connected",
    e.gamepad.id,
    true 
);

    console.log("🎮 Controller Connected");
    console.log(gamepad.id);

});

window.addEventListener("gamepaddisconnected",(e)=>{

    console.log("🎮 Controller Disconnected");
    showControllerToast(
    "Controller Disconnected",
    e.gamepad.id,
    false
);

    gamepad = null;

    document
        .querySelectorAll(".controller-selected")
        .forEach(el=>{

            el.classList.remove("controller-selected");

            el.style.zIndex = "";

        });

    if (window.LudoMPFocus) {

        window.LudoMPFocus.reset();

    }

});

function repeatButton(direction) {

    const now = performance.now();

    if (heldDirection !== direction) {

        heldDirection = direction;
        firstRepeat = true;
        nextRepeatTime = now;

    }

    if (now >= nextRepeatTime) {

        onButtonPressed(direction);

        if (firstRepeat) {

            nextRepeatTime = now + FIRST_REPEAT_DELAY;
            firstRepeat = false;

        } else {

            nextRepeatTime = now + REPEAT_DELAY;

        }

    }

}

function updateController() {

    const pads = [...navigator.getGamepads()];

// Find the first connected controller
gamepad = pads.find(p => p);

if (gamepad) {

    if (window.LudoMPFocus) {

        window.LudoMPFocus.tick();

    }

    // Buttons
    gamepad.buttons.forEach((button, index) => {

        const wasPressed = previousButtons[index] || false;

        if (button.pressed && !wasPressed) {
            onButtonPressed(index);
        }

        previousButtons[index] = button.pressed;

    });

// Left Stick

const x = gamepad.axes[0];
const y = gamepad.axes[1];

if (y < -0.6) {

    repeatButton(BTN.UP);

}
else if (y > 0.6) {

    repeatButton(BTN.DOWN);

}
else if (x < -0.6) {

    repeatButton(BTN.LEFT);

}
else if (x > 0.6) {

    repeatButton(BTN.RIGHT);

}
else {

    heldDirection = null;

}
    }

    requestAnimationFrame(updateController);
}

requestAnimationFrame(updateController);


// =========================
// CONTROLLER VIBRATION TEST
// =========================

/*=========================================
        CONTROLLER HAPTICS ENGINE
=========================================*/

async function rumble(weak, strong, duration){

    if(!gamepad) return;

    const actuator = gamepad.vibrationActuator;

    if(!actuator) return;

    try{

        await actuator.reset?.();

        await actuator.playEffect("dual-rumble",{
            startDelay:0,
            duration,
            weakMagnitude:Math.min(1,Math.max(0,weak)),
            strongMagnitude:Math.min(1,Math.max(0,strong))
        });

    }catch(e){
        console.log("Rumble failed:",e);
    }

}

const Haptics = {

    menu(){

        rumble(.12,.05,18);

    },

    toggleOn(){

        rumble(.30,.18,40);

    },

    toggleOff(){

        rumble(.18,.10,28);

    },

    pause(){

        rumble(.55,.30,90);

    },

    resume(){

        rumble(.30,.15,45);

    },

    dice(){

        rumble(.65,.35,170);

    },

    step(){

        rumble(.28,.20,45);

    },

    leaveBase(){

        rumble(.45,.25,80);

    },

    capture(){

        rumble(.40,.45,220);

    },

    home(){

        rumble(.55,.40,120);

    },

    victory(){

        rumble(.40,.90,150);

        setTimeout(()=>rumble(.6,.4,150),220);

        setTimeout(()=>rumble(1,1,280),470);

    },

    startGame(){

    rumble(.95,.75,280);

    }

};

function refreshSelectableTokens(){

    selectableTokens = window.validControllerTokens || [];

    if(selectedTokenIndex >= selectableTokens.length){

        selectedTokenIndex = 0;

    }

}

function updateControllerHighlight(){

    // Always clear previous highlight
    document.querySelectorAll(".controller-selected")
        .forEach(el=>{
            el.classList.remove("controller-selected");
            el.style.zIndex = "";
        });

    // No controller connected
    if(!gamepad)
        return;

    // Not choosing a token
    if(state !== "selecting")
        return;

    // Nothing to select
    if(selectableTokens.length <= 1)
        return;

    const token = selectableTokens[selectedTokenIndex];

    if(token && token.el){

        token.el.classList.add("controller-selected");
        token.el.style.zIndex = "9999";

    }

}

function onButtonPressed(button){

    console.log("Button :",button);

const now = performance.now();

if(now - lastButtonTime < BUTTON_COOLDOWN)
    return;

lastButtonTime = now;

const setupVisible =
    !document
        .getElementById("setup-screen")
        .classList.contains("hidden");

const settingsVisible =
    !document
        .getElementById("settings-modal")
        .classList.contains("hidden");

const pauseVisible =
    !document
        .getElementById("pause-screen")
        .classList.contains("hidden");

if(settingsVisible){

    handleSettingsMenu(button);

    return;

}

if(pauseVisible){

    handlePauseMenu(button);

    return;

}

if (window.LudoMPFocus && window.LudoMPFocus.handleButton(button)) {

    return;

}

// Online gameplay is fully handled above; never fall through to the
// single-player engine while an online match owns the board.
if (window.LudoOnline && window.LudoOnline.active) {

    return;

}

if(setupVisible){

    handleSetupMenu(button);

    return;

}

    switch(button){

        //=========================
        // A BUTTON
        //=========================

        case BTN.A:

                if ( state === "waiting" && 
                    players[turnIndex].type !== "ai"){

                if(Debug.alwaysSix){

                    window.debugForcedDice = 6;

                }

                Haptics.dice();

                handleDiceClick();

            }

            break;

        //=========================
        // START BUTTON
        //=========================

        case BTN.START:

            if(typeof togglePause === "function"){

                Haptics.pause()
                togglePause();

            }

            break;

            case BTN.RB:

            refreshSelectableTokens();

            if(selectableTokens.length === 0)
                break;

            selectedTokenIndex++;

            if(selectedTokenIndex >= selectableTokens.length)
                selectedTokenIndex = 0;

            updateControllerHighlight();
            console.log(
                "Selected:",
                selectableTokens[selectedTokenIndex].id
            );

            Haptics.menu();

            break;


            case BTN.LB:

            refreshSelectableTokens();

            if(selectableTokens.length === 0)
                break;

            selectedTokenIndex--;

            if(selectedTokenIndex < 0)
                selectedTokenIndex = selectableTokens.length - 1;
            updateControllerHighlight();
            console.log(
                "Selected:",
                selectableTokens[selectedTokenIndex].id
            );

            Haptics.menu();

            break;

            case BTN.Y:

            Debug.alwaysSix = !Debug.alwaysSix;

            console.log(
                "🎲 Always Six:",
                Debug.alwaysSix ? "ON" : "OFF"
            );

            if(Debug.alwaysSix){

                Haptics.toggleOn();

            }else{

                Haptics.toggleOff();

            }

            break;

            case BTN.X:

        refreshSelectableTokens();

        if(state !== "selecting")
            break;

        if(selectableTokens.length === 0)
            break;

        // Remove mouse highlight
        selectableTokens.forEach(t =>
            t.el.classList.remove("highlight")
        );

        // Remove controller highlight
        document.querySelectorAll(".controller-selected")
            .forEach(el => el.classList.remove("controller-selected"));

        executeMove(
            selectableTokens[selectedTokenIndex]
        );

        Haptics.step();

        break;

    }

}

function handleSetupMenu(button){

    const singlePanel = document.getElementById("setup-single");

    if (singlePanel && singlePanel.classList.contains("hidden")) {
        return;
    }

    switch(button){

        case BTN.DOWN:

            setupFocus++;

            if(setupFocus >= setupControls.length)
                setupFocus = 0;

            updateSetupFocus();

            Haptics.menu();

            break;


        case BTN.UP:

            setupFocus--;

            if(setupFocus < 0)
                setupFocus = setupControls.length - 1;

            updateSetupFocus();

            Haptics.menu();

            break;


        case BTN.RIGHT:

        case BTN.LEFT:

            if(setupFocus > 3)
                break;

            const select =
                document.getElementById(
                    setupControls[setupFocus]
                );

            if(button === BTN.RIGHT){

                select.selectedIndex++;

                if(select.selectedIndex >= select.options.length)
                    select.selectedIndex = 0;

            }else{

                select.selectedIndex--;

                if(select.selectedIndex < 0)
                    select.selectedIndex =
                        select.options.length - 1;

            }

            Haptics.menu();

            break;


        case BTN.B:

            if (window.LudoMPFocus) {

                window.LudoMPFocus.openTabs();

            }

            break;

        case BTN.A:

            if(setupFocus === 4){
                    settingsSource = "setup";
                document
                    .getElementById("open-settings-btn")
                    .click();
                    settingsFocus = 0;

        updateSettingsFocus();

            }
            else if(setupFocus === 5){

                Haptics.startGame();

                setTimeout(() => {
                document
                    .getElementById("enter-arena")
                    .click();
                }, 280);

            }

            Haptics.menu();

            break;

    }

}

function activateCurrentSetting() {

    const element = document.getElementById(
        settingsControls[settingsFocus]
    );

    if (!element) return;

    if (element.type === "checkbox") {

        element.checked = !element.checked;
        element.dispatchEvent(new Event("change"));

        Haptics.menu();

        return;
    }

    if (element.id === "close-settings-btn") {

        element.click();

        Haptics.resume();
    }

}

function adjustCurrentSetting(direction) {

    const element = document.getElementById(
        settingsControls[settingsFocus]
    );

    if (!element) return;

    if (element.type !== "range") return;

    const step = Number(element.step) || 1;

    let value = Number(element.value);

    value += direction * step;

    value = Math.max(
        Number(element.min),
        Math.min(Number(element.max), value)
    );

    element.value = value;

    element.dispatchEvent(new Event("input"));

    Haptics.menu();

}

function handleSettingsMenu(button){

    switch(button){

        case BTN.DOWN:

            settingsFocus++;

            if(settingsFocus >= settingsControls.length)
                settingsFocus = 0;

            updateSettingsFocus();

            Haptics.menu();

            break;


        case BTN.UP:

            settingsFocus--;

            if(settingsFocus < 0)
                settingsFocus =
                    settingsControls.length-1;

            updateSettingsFocus();

            Haptics.menu();

            break;

        case BTN.LEFT:
            adjustCurrentSetting(-1);
            break;

        case BTN.RIGHT:
            adjustCurrentSetting(1);
            break;

            case BTN.A:

            activateCurrentSetting();

            break;

            case BTN.B:
            case BTN.START:

                document
                    .getElementById("close-settings-btn")
                    .click(); 
                Haptics.resume();

            break;

    }

}

//PAUSE MENU
const pauseControls = [

    "pause-resume-btn",

    "pause-settings-btn",

    "pause-restart-btn",

    "pause-exit-btn"

];

function updatePauseFocus(){

    pauseControls.forEach(id=>{

        document
            .getElementById(id)
            ?.classList.remove("controller-focus");

    });

    document
        .getElementById(
            pauseControls[pauseFocus]
        )
        ?.classList.add("controller-focus");

}

function handlePauseMenu(button){

    switch(button){

        case BTN.DOWN:

            pauseFocus++;

            if(pauseFocus >= pauseControls.length)
                pauseFocus = 0;

            updatePauseFocus();
            Haptics.menu();

        break;

        case BTN.UP:

            pauseFocus--;

            if(pauseFocus < 0)
                pauseFocus = pauseControls.length-1;

            updatePauseFocus();
            Haptics.menu();

        break;

        case BTN.A:

            document
                .getElementById(
                    pauseControls[pauseFocus]
                )
                .click();

        break;

        case BTN.B:

        case BTN.START:

            togglePause();

            Haptics.resume();

        break;

    }

}

/*=========================================
    MULTIPLAYER FOCUS / NAVIGATION
    Reusable gamepad focus for the mode tabs,
    local setup, online setup, lobby and results,
    plus server-authoritative online play input.
=========================================*/

const MP_MODES = ["single", "local", "online"];

const mpNav = {

    scope: null,
    key: null,
    tabMode: "single",
    editing: false,
    editEl: null,
    lastRender: "",
    activationLockUntil: 0

};

let mpLastSync = 0;

let mpLastOnlineRevision = -1;

function mpIsShown(id) {

    const el = document.getElementById(id);

    return !!el && !el.classList.contains("hidden");

}

function mpSetupMode() {

    if (mpIsShown("setup-local")) return "local";
    if (mpIsShown("setup-online")) return "online";

    return "single";

}

function mpScreenScope() {

    if (
        !mpIsShown("setup-screen") &&
        !mpIsShown("lobby-screen") &&
        !mpIsShown("result-screen")
    ) {

        return null;

    }

    if (mpIsShown("settings-modal") || mpIsShown("pause-screen")) {

        return null;

    }

    if (mpIsShown("lobby-screen")) return "lobby";
    if (mpIsShown("result-screen")) return "result";

    if (mpIsShown("setup-local")) return "local";
    if (mpIsShown("setup-online")) return "online";

    return null;

}

function mpClearFocus() {

    document
        .querySelectorAll(
            "#setup-screen .controller-focus, " +
            "#lobby-screen .controller-focus, " +
            "#result-screen .controller-focus"
        )
        .forEach((el) => el.classList.remove("controller-focus"));

    mpNav.lastRender = "";

}

function mpApplyFocus(items) {

    if (!items.length) return;

    let item = items.find((entry) => entry.key === mpNav.key);

    if (!item) item = items[0];

    mpNav.key = item.key;

    const signature =
        mpNav.key +
        "|" +
        items
            .map((entry) => entry.key + (entry.el.disabled ? "d" : ""))
            .join(",");

    const focused = document.querySelector(
        "#setup-screen .controller-focus, " +
        "#lobby-screen .controller-focus, " +
        "#result-screen .controller-focus"
    );

    if (
        signature === mpNav.lastRender &&
        focused === item.el &&
        item.el.classList.contains("controller-focus")
    ) {

        return;

    }

    mpClearFocus();

    item.el.classList.add("controller-focus");

    item.el.scrollIntoView({ behavior: "auto", block: "nearest" });

    mpNav.lastRender = signature;

}

function mpTabItems() {

    return Array.from(document.querySelectorAll(".mode-tab")).map((tab) => ({

        key: "tab:" + tab.dataset.mode,
        el: tab,
        type: "tab",
        activate: () => mpCommitTab(tab.dataset.mode),
        adjust: (direction) => mpShiftTab(direction)

    }));

}

function mpEnterTabs() {

    if (!mpIsShown("setup-screen")) return;

    mpNav.scope = "tabs";
    mpNav.tabMode = mpSetupMode();
    mpNav.key = "tab:" + mpNav.tabMode;
    mpNav.editing = false;

    if (mpNav.editEl) {

        mpNav.editEl.blur();
        mpNav.editEl = null;

    }

    Haptics.menu();

    mpSync(true);

}

function mpShiftTab(direction) {

    const index = MP_MODES.indexOf(mpNav.tabMode);

    mpNav.tabMode =
        MP_MODES[(index + direction + MP_MODES.length) % MP_MODES.length];

    mpNav.key = "tab:" + mpNav.tabMode;

    Haptics.menu();

    mpSync(true);

}

function mpCommitTab(mode) {

    const tab = document.querySelector('.mode-tab[data-mode="' + mode + '"]');

    if (!tab) return;

    Haptics.menu();

    mpClearFocus();

    mpNav.scope = null;
    mpNav.key = null;

    tab.click();

    if (mode === "single") {

        updateSetupFocus();
        return;

    }

    mpSync(true);

}

function mpCancelTabs() {

    mpNav.scope = null;
    mpNav.key = null;

    mpClearFocus();

    if (mpSetupMode() === "single") {

        updateSetupFocus();

    } else {

        mpSync(true);

    }

    Haptics.menu();

}

function mpChangeLocalCount(direction) {

    const current = document.querySelector(
        "#local-count-row .mp-count-btn.active"
    );

    const count = current ? Number(current.dataset.count) : 2;

    const safeCount = Number.isFinite(count) ? count : 2;

    const next = ((safeCount - 2 + direction + 3) % 3) + 2;

    const button = document.querySelector(
        '#local-count-row .mp-count-btn[data-count="' + next + '"]'
    );

    if (!button) return;

    Haptics.menu();

    button.click();

    mpSync(true);

}

function mpCycleSelect(select, direction) {

    if (!select || !select.options.length) return;

    let index = select.selectedIndex + direction;

    if (index < 0) index = select.options.length - 1;

    if (index >= select.options.length) index = 0;

    select.selectedIndex = index;

    select.dispatchEvent(new Event("change", { bubbles: true }));

    Haptics.menu();

}

function mpActivateButton(element, options) {

    options = options || {};

    if (!element || element.disabled) return;

    const now = performance.now();

    if (now < mpNav.activationLockUntil) return;

    mpNav.activationLockUntil = now + (options.lock || 320);

    if (options.haptic) {

        options.haptic();

    } else {

        Haptics.menu();

    }

    if (options.delay) {

        setTimeout(() => element.click(), options.delay);

    } else {

        element.click();

    }

}

function mpStartTextEdit(input) {

    if (!input) return;

    mpNav.editing = true;
    mpNav.editEl = input;

    input.focus({ preventScroll: true });

    try {

        input.select();

    } catch (e) {}

    Haptics.menu();

}

function mpStopTextEdit() {

    if (mpNav.editEl) {

        mpNav.editEl.blur();

    }

    mpNav.editing = false;
    mpNav.editEl = null;
    mpNav.lastRender = "";

    mpSync(true);

    Haptics.menu();

}

function mpLocalItems() {

    const items = [];

    const activeCount =
        document.querySelector("#local-count-row .mp-count-btn.active") ||
        document.querySelector("#local-count-row .mp-count-btn");

    if (activeCount) {

        items.push({

            key: "local:count",
            el: activeCount,
            type: "count",
            activate: () => mpChangeLocalCount(1),
            adjust: (direction) => mpChangeLocalCount(direction)

        });

    }

    document
        .querySelectorAll("#local-players .mp-player-row")
        .forEach((row, index) => {

            const name = row.querySelector(".mp-name-input");
            const color = row.querySelector(".mp-color-select");

            if (name) {

                items.push({

                    key: "local:name:" + index,
                    el: name,
                    type: "text",
                    activate: () => mpStartTextEdit(name)

                });

            }

            if (color) {

                items.push({

                    key: "local:color:" + index,
                    el: color,
                    type: "select",
                    activate: () => mpCycleSelect(color, 1),
                    adjust: (direction) => mpCycleSelect(color, direction)

                });

            }

        });

    const start = document.getElementById("local-start-btn");

    if (start) {

        items.push({

            key: "local:start",
            el: start,
            type: "button",
            activate: () =>
                mpActivateButton(start, {
                    haptic: () => Haptics.startGame(),
                    delay: 280,
                    lock: 800
                })

        });

    }

    const settings = document.getElementById("local-settings-btn");

    if (settings) {

        items.push({

            key: "local:settings",
            el: settings,
            type: "button",
            activate: () => mpActivateButton(settings)

        });

    }

    return items;

}

function mpOnlineItems() {

    const items = [];

    const name = document.getElementById("online-name");

    if (name) {

        items.push({

            key: "online:name",
            el: name,
            type: "text",
            activate: () => mpStartTextEdit(name)

        });

    }

    const color = document.getElementById("online-color");

    if (color) {

        items.push({

            key: "online:color",
            el: color,
            type: "select",
            activate: () => mpCycleSelect(color, 1),
            adjust: (direction) => mpCycleSelect(color, direction)

        });

    }

    const create = document.getElementById("create-room-btn");

    if (create) {

        items.push({

            key: "online:create",
            el: create,
            type: "button",
            activate: () => mpActivateButton(create, { lock: 1200 })

        });

    }

    const code = document.getElementById("join-code");

    if (code) {

        items.push({

            key: "online:code",
            el: code,
            type: "text",
            activate: () => mpStartTextEdit(code)

        });

    }

    const join = document.getElementById("join-room-btn");

    if (join) {

        items.push({

            key: "online:join",
            el: join,
            type: "button",
            activate: () => mpActivateButton(join, { lock: 1200 })

        });

    }

    const resume = document.getElementById("online-resume-btn");

    if (resume && !resume.classList.contains("hidden")) {

        items.push({

            key: "online:resume",
            el: resume,
            type: "button",
            activate: () => mpActivateButton(resume, { lock: 1200 })

        });

    }

    return items;

}

function mpLobbyItems() {

    const items = [];

    const start = document.getElementById("lobby-start-btn");

    if (start && !start.classList.contains("hidden")) {

        items.push({

            key: "lobby:start",
            el: start,
            type: "button",
            activate: () => {

                if (start.disabled) {

                    Haptics.toggleOff();
                    return;

                }

                mpActivateButton(start, { lock: 1200 });

            }

        });

    }

    const copy = document.getElementById("copy-code-btn");

    if (copy) {

        items.push({

            key: "lobby:copy",
            el: copy,
            type: "button",
            activate: () => mpActivateButton(copy)

        });

    }

    const leave = document.getElementById("lobby-leave-btn");

    if (leave) {

        items.push({

            key: "lobby:leave",
            el: leave,
            type: "button",
            activate: () =>
                mpActivateButton(leave, {
                    haptic: () => Haptics.resume(),
                    lock: 700
                })

        });

    }

    return items;

}

function mpResultItems() {

    const items = [];

    const primary = document.getElementById("result-primary-btn");

    if (primary && !primary.disabled) {

        items.push({

            key: "result:primary",
            el: primary,
            type: "button",
            activate: () =>
                mpActivateButton(primary, {
                    haptic: () => Haptics.startGame(),
                    lock: 800
                })

        });

    }

    const secondary = document.getElementById("result-secondary-btn");

    if (secondary && !secondary.classList.contains("hidden")) {

        items.push({

            key: "result:secondary",
            el: secondary,
            type: "button",
            activate: () =>
                mpActivateButton(secondary, {
                    haptic: () => Haptics.resume(),
                    lock: 800
                })

        });

    }

    return items;

}

function mpItemsFor(scope) {

    switch (scope) {

        case "local":
            return mpLocalItems();

        case "online":
            return mpOnlineItems();

        case "lobby":
            return mpLobbyItems();

        case "result":
            return mpResultItems();

        default:
            return [];

    }

}

function mpSync(force) {

    if (!gamepad) return null;

    if (mpNav.editing) {

        const input = mpNav.editEl;

        if (
            !input ||
            !input.isConnected ||
            input.offsetParent === null ||
            document.activeElement !== input
        ) {

            mpNav.editing = false;
            mpNav.editEl = null;

        } else {

            return null;

        }

    }

    let scope = mpScreenScope();
    let items;

    if (mpNav.scope === "tabs") {

        if (
            !mpIsShown("setup-screen") ||
            mpIsShown("settings-modal") ||
            mpIsShown("pause-screen")
        ) {

            mpNav.scope = null;
            mpNav.key = null;
            mpClearFocus();
            return null;

        }

        items = mpTabItems();

        if (!items.some((item) => item.key === mpNav.key)) {

            mpNav.tabMode = mpSetupMode();
            mpNav.key = "tab:" + mpNav.tabMode;

        }

        scope = "tabs";

    } else {

        if (!scope) {

            if (mpNav.scope) {

                mpNav.scope = null;
                mpClearFocus();

            }

            return null;

        }

        items = mpItemsFor(scope);

        if (!items.length) return null;

        if (
            scope !== mpNav.scope ||
            !items.some((item) => item.key === mpNav.key)
        ) {

            mpNav.key = items[0].key;

        }

    }

    mpNav.scope = scope;

    if (force) mpNav.lastRender = "";

    mpApplyFocus(items);

    return { scope: scope, items: items };

}

function mpCurrent(ctx) {

    let index = ctx.items.findIndex((item) => item.key === mpNav.key);

    if (index < 0) index = 0;

    return { index: index, item: ctx.items[index] };

}

function mpMoveFocus(direction) {

    const ctx = mpSync(true);

    if (!ctx || ctx.scope === "tabs") return;

    const current = mpCurrent(ctx);

    if (
        direction < 0 &&
        current.index === 0 &&
        (ctx.scope === "local" || ctx.scope === "online")
    ) {

        mpEnterTabs();
        return;

    }

    const next =
        (current.index + direction + ctx.items.length) % ctx.items.length;

    mpNav.key = ctx.items[next].key;
    mpNav.lastRender = "";

    Haptics.menu();

    mpApplyFocus(ctx.items);

}

function mpAdjustFocus(direction) {

    const ctx = mpSync(true);

    if (!ctx) return;

    if (ctx.scope === "tabs") {

        mpShiftTab(direction);
        return;

    }

    const current = mpCurrent(ctx);

    if (current.item && current.item.adjust) {

        current.item.adjust(direction);

    }

}

function mpActivateFocus() {

    const ctx = mpSync(true);

    if (!ctx) return;

    if (ctx.scope === "tabs") {

        mpCommitTab(mpNav.tabMode);
        return;

    }

    const current = mpCurrent(ctx);

    if (current.item && current.item.activate) {

        current.item.activate();

    }

}

function mpOnlineIsMyTurn(state, online) {

    if (
        !state ||
        !online ||
        !online.you ||
        !Array.isArray(state.players)
    ) {

        return false;

    }

    const current = state.players[state.turnIndex];

    return !!current && current.id === online.you.id;

}

function mpRefreshOnlineTokens() {

    const online = window.LudoOnline;
    const state = online && online.gameState;

    if (
        !online ||
        !online.active ||
        !state ||
        state.state !== "awaiting-move" ||
        !mpOnlineIsMyTurn(state, online)
    ) {

        selectableTokens = [];
        window.validControllerTokens = [];
        return;

    }

    const ids = Array.isArray(state.legalTokenIds)
        ? state.legalTokenIds
        : [];

    selectableTokens = ids
        .map((id) =>
            (tokens || []).find((token) => token.id === id && token.el)
        )
        .filter(Boolean);

    window.validControllerTokens = selectableTokens;

    if (selectedTokenIndex >= selectableTokens.length) {

        selectedTokenIndex = 0;

    }

}

function mpSelectedOnlineToken() {

    mpRefreshOnlineTokens();

    if (!selectableTokens.length) return null;

    if (selectedTokenIndex >= selectableTokens.length) {

        selectedTokenIndex = 0;

    }

    return selectableTokens[selectedTokenIndex];

}

function mpCycleOnlineToken(direction) {

    mpRefreshOnlineTokens();

    if (!selectableTokens.length) return;

    selectedTokenIndex =
        (selectedTokenIndex + direction + selectableTokens.length) %
        selectableTokens.length;

    updateControllerHighlight();

    Haptics.menu();

}

function mpHandleOnlineGame(button) {

    const online = window.LudoOnline;

    if (!online || !online.active) return false;

    if (!mpIsShown("game-screen")) return false;

    if (mpIsShown("settings-modal") || mpIsShown("pause-screen")) {

        return false;

    }

    if (button === BTN.START) {

        Haptics.pause();

        togglePause();

        return true;

    }

    const state = online.gameState;
    const myTurn = mpOnlineIsMyTurn(state, online);

    switch (button) {

        case BTN.A:

            if (!myTurn || !state) return true;

            if (state.state === "awaiting-roll" && !online.diceLocked) {

                Haptics.dice();

                online.handleDiceClick();

            } else if (state.state === "awaiting-move") {

                const token = mpSelectedOnlineToken();

                if (token && !online.movePending) {

                    Haptics.step();

                    online.submitMove(token.id);

                }

            }

            return true;

        case BTN.X:

            if (myTurn && state && state.state === "awaiting-move") {

                const token = mpSelectedOnlineToken();

                if (token && !online.movePending) {

                    Haptics.step();

                    online.submitMove(token.id);

                }

            }

            return true;

        case BTN.LB:

            if (myTurn && state && state.state === "awaiting-move") {

                mpCycleOnlineToken(-1);

            }

            return true;

        case BTN.RB:

            if (myTurn && state && state.state === "awaiting-move") {

                mpCycleOnlineToken(1);

            }

            return true;

        case BTN.LEFT:

        case BTN.RIGHT:

            if (myTurn && state && state.state === "awaiting-move") {

                mpCycleOnlineToken(button === BTN.LEFT ? -1 : 1);

            }

            return true;

        default:

            return true;

    }

}

function mpHandleButton(button) {

    if (mpNav.editing) {

        if (button === BTN.A || button === BTN.B || button === BTN.START) {

            mpStopTextEdit();

        }

        return true;

    }

    const tabsActive = mpNav.scope === "tabs";

    const scope = mpScreenScope();

    if (!tabsActive && !scope) {

        return mpHandleOnlineGame(button);

    }

    const ctx = mpSync(true);

    if (!ctx) return false;

    if (ctx.scope === "tabs") {

        switch (button) {

            case BTN.LEFT:
                mpShiftTab(-1);
                return true;

            case BTN.RIGHT:
                mpShiftTab(1);
                return true;

            case BTN.A:
            case BTN.DOWN:
                mpCommitTab(mpNav.tabMode);
                return true;

            case BTN.B:
            case BTN.UP:
                mpCancelTabs();
                return true;

            default:
                return true;

        }

    }

    switch (button) {

        case BTN.UP:
            mpMoveFocus(-1);
            return true;

        case BTN.DOWN:
            mpMoveFocus(1);
            return true;

        case BTN.LEFT:
            mpAdjustFocus(-1);
            return true;

        case BTN.RIGHT:
            mpAdjustFocus(1);
            return true;

        case BTN.A:
            mpActivateFocus();
            return true;

        case BTN.B:

            if (ctx.scope === "local" || ctx.scope === "online") {

                mpEnterTabs();

            } else if (ctx.scope === "lobby") {

                const leave = document.getElementById("lobby-leave-btn");

                if (leave) {

                    mpActivateButton(leave, {
                        haptic: () => Haptics.resume(),
                        lock: 700
                    });

                }

            }

            return true;

        case BTN.START:
            return true;

        default:
            return true;

    }

}

function mpTick() {

    if (!gamepad) return;

    const now = performance.now();

    if (now - mpLastSync < 180) return;

    mpLastSync = now;

    mpSync(false);

    const online = window.LudoOnline;

    if (online && online.active && mpIsShown("game-screen")) {

        const revision = online.gameState
            ? online.gameState.revision
            : -1;

        if (revision !== mpLastOnlineRevision) {

            mpLastOnlineRevision = revision;

            selectedTokenIndex = 0;

            mpRefreshOnlineTokens();

            updateControllerHighlight();

        }

    } else {

        mpLastOnlineRevision = -1;

    }

}

function mpReset() {

    mpNav.scope = null;
    mpNav.key = null;
    mpNav.editing = false;
    mpNav.lastRender = "";
    mpNav.activationLockUntil = 0;

    if (mpNav.editEl) {

        mpNav.editEl.blur();
        mpNav.editEl = null;

    }

    mpClearFocus();

}

window.LudoMPFocus = {

    handleButton: mpHandleButton,
    tick: mpTick,
    openTabs: mpEnterTabs,
    reset: mpReset,
    state: () => Object.assign({}, mpNav)

};
