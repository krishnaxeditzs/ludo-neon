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
  RIGHT: 15,
};

/*=========================================
        DEBUG
=========================================*/

const Debug = {
  alwaysSix: false,
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

  "enter-arena",
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

  "close-settings-btn",
];

function updateSetupFocus() {
  setupControls.forEach((id) => {
    document.getElementById(id)?.classList.remove("controller-focus");
  });

  document
    .getElementById(setupControls[setupFocus])
    ?.classList.add("controller-focus");
}

function updateSettingsFocus() {
  settingsControls.forEach((id) => {
    document.getElementById(id)?.classList.remove("controller-focus");
  });

  const element = document.getElementById(settingsControls[settingsFocus]);

  if (element) {
    element.classList.add("controller-focus");

    element.scrollIntoView({
      behavior: "auto",
      block: "center",
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

window.addEventListener("gamepadconnected", (e) => {
  gamepad = e.gamepad;
  showControllerToast("Controller Connected", e.gamepad.id, true);

  console.log("🎮 Controller Connected");
  console.log(gamepad.id);
});

window.addEventListener("gamepaddisconnected", (e) => {
  console.log("🎮 Controller Disconnected");
  showControllerToast("Controller Disconnected", e.gamepad.id, false);

  gamepad = null;

  document.querySelectorAll(".controller-selected").forEach((el) => {
    el.classList.remove("controller-selected");

    el.style.zIndex = "";
  });
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
  gamepad = pads.find((p) => p);

  if (gamepad) {
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
    } else if (y > 0.6) {
      repeatButton(BTN.DOWN);
    } else if (x < -0.6) {
      repeatButton(BTN.LEFT);
    } else if (x > 0.6) {
      repeatButton(BTN.RIGHT);
    } else {
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

async function rumble(weak, strong, duration) {
  if (!gamepad) return;

  const actuator = gamepad.vibrationActuator;

  if (!actuator) return;

  try {
    await actuator.reset?.();

    await actuator.playEffect("dual-rumble", {
      startDelay: 0,
      duration,
      weakMagnitude: Math.min(1, Math.max(0, weak)),
      strongMagnitude: Math.min(1, Math.max(0, strong)),
    });
  } catch (e) {
    console.log("Rumble failed:", e);
  }
}

const Haptics = {
  menu() {
    rumble(0.12, 0.05, 18);
  },

  toggleOn() {
    rumble(0.3, 0.18, 40);
  },

  toggleOff() {
    rumble(0.18, 0.1, 28);
  },

  pause() {
    rumble(0.55, 0.3, 90);
  },

  resume() {
    rumble(0.3, 0.15, 45);
  },

  dice() {
    rumble(0.65, 0.35, 170);
  },

  step() {
    rumble(0.28, 0.2, 45);
  },

  leaveBase() {
    rumble(0.45, 0.25, 80);
  },

  capture() {
    rumble(0.4, 0.45, 220);
  },

  home() {
    rumble(0.55, 0.4, 120);
  },

  victory() {
    rumble(0.4, 0.9, 150);

    setTimeout(() => rumble(0.6, 0.4, 150), 220);

    setTimeout(() => rumble(1, 1, 280), 470);
  },

  startGame() {
    rumble(0.95, 0.75, 280);
  },
};

function refreshSelectableTokens() {
  selectableTokens = window.validControllerTokens || [];

  if (selectedTokenIndex >= selectableTokens.length) {
    selectedTokenIndex = 0;
  }
}

function updateControllerHighlight() {
  // Always clear previous highlight
  document.querySelectorAll(".controller-selected").forEach((el) => {
    el.classList.remove("controller-selected");
    el.style.zIndex = "";
  });

  // No controller connected
  if (!gamepad) return;

  // Not choosing a token
  if (state !== "selecting") return;

  // Nothing to select
  if (selectableTokens.length <= 1) return;

  const token = selectableTokens[selectedTokenIndex];

  if (token && token.el) {
    token.el.classList.add("controller-selected");
    token.el.style.zIndex = "9999";
  }
}

function onButtonPressed(button) {
  console.log("Button :", button);

  const now = performance.now();

  if (now - lastButtonTime < BUTTON_COOLDOWN) return;

  lastButtonTime = now;

  const setupVisible = !document
    .getElementById("setup-screen")
    .classList.contains("hidden");

  const settingsVisible = !document
    .getElementById("settings-modal")
    .classList.contains("hidden");

  const pauseVisible = !document
    .getElementById("pause-screen")
    .classList.contains("hidden");

  if (settingsVisible) {
    handleSettingsMenu(button);

    return;
  }

  if (pauseVisible) {
    handlePauseMenu(button);

    return;
  }

  if (setupVisible) {
    handleSetupMenu(button);

    return;
  }

  switch (button) {
    //=========================
    // A BUTTON
    //=========================

    case BTN.A:
      if (state === "waiting" && players[turnIndex].type !== "ai") {
        if (Debug.alwaysSix) {
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
      if (typeof togglePause === "function") {
        Haptics.pause();
        togglePause();
      }

      break;

    case BTN.RB:
      refreshSelectableTokens();

      if (selectableTokens.length === 0) break;

      selectedTokenIndex++;

      if (selectedTokenIndex >= selectableTokens.length) selectedTokenIndex = 0;

      updateControllerHighlight();
      console.log("Selected:", selectableTokens[selectedTokenIndex].id);

      Haptics.menu();

      break;

    case BTN.LB:
      refreshSelectableTokens();

      if (selectableTokens.length === 0) break;

      selectedTokenIndex--;

      if (selectedTokenIndex < 0)
        selectedTokenIndex = selectableTokens.length - 1;
      updateControllerHighlight();
      console.log("Selected:", selectableTokens[selectedTokenIndex].id);

      Haptics.menu();

      break;

    case BTN.Y:
      Debug.alwaysSix = !Debug.alwaysSix;

      console.log("🎲 Always Six:", Debug.alwaysSix ? "ON" : "OFF");

      if (Debug.alwaysSix) {
        Haptics.toggleOn();
      } else {
        Haptics.toggleOff();
      }

      break;

    case BTN.X:
      refreshSelectableTokens();

      if (state !== "selecting") break;

      if (selectableTokens.length === 0) break;

      // Remove mouse highlight
      selectableTokens.forEach((t) => t.el.classList.remove("highlight"));

      // Remove controller highlight
      document
        .querySelectorAll(".controller-selected")
        .forEach((el) => el.classList.remove("controller-selected"));

      executeMove(selectableTokens[selectedTokenIndex]);

      Haptics.step();

      break;
  }
}

function handleSetupMenu(button) {
  switch (button) {
    case BTN.DOWN:
      setupFocus++;

      if (setupFocus >= setupControls.length) setupFocus = 0;

      updateSetupFocus();

      Haptics.menu();

      break;

    case BTN.UP:
      setupFocus--;

      if (setupFocus < 0) setupFocus = setupControls.length - 1;

      updateSetupFocus();

      Haptics.menu();

      break;

    case BTN.RIGHT:

    case BTN.LEFT:
      if (setupFocus > 3) break;

      const select = document.getElementById(setupControls[setupFocus]);

      if (button === BTN.RIGHT) {
        select.selectedIndex++;

        if (select.selectedIndex >= select.options.length)
          select.selectedIndex = 0;
      } else {
        select.selectedIndex--;

        if (select.selectedIndex < 0)
          select.selectedIndex = select.options.length - 1;
      }

      Haptics.menu();

      break;

    case BTN.A:
      if (setupFocus === 4) {
        settingsSource = "setup";
        document.getElementById("open-settings-btn").click();
        settingsFocus = 0;

        updateSettingsFocus();
      } else if (setupFocus === 5) {
        Haptics.startGame();

        setTimeout(() => {
          document.getElementById("enter-arena").click();
        }, 280);
      }

      Haptics.menu();

      break;
  }
}

function activateCurrentSetting() {
  const element = document.getElementById(settingsControls[settingsFocus]);

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
  const element = document.getElementById(settingsControls[settingsFocus]);

  if (!element) return;

  if (element.type !== "range") return;

  const step = Number(element.step) || 1;

  let value = Number(element.value);

  value += direction * step;

  value = Math.max(Number(element.min), Math.min(Number(element.max), value));

  element.value = value;

  element.dispatchEvent(new Event("input"));

  Haptics.menu();
}

function handleSettingsMenu(button) {
  switch (button) {
    case BTN.DOWN:
      settingsFocus++;

      if (settingsFocus >= settingsControls.length) settingsFocus = 0;

      updateSettingsFocus();

      Haptics.menu();

      break;

    case BTN.UP:
      settingsFocus--;

      if (settingsFocus < 0) settingsFocus = settingsControls.length - 1;

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
      document.getElementById("close-settings-btn").click();
      Haptics.resume();

      break;
  }
}

//PAUSE MENU
const pauseControls = [
  "pause-resume-btn",

  "pause-settings-btn",

  "pause-restart-btn",

  "pause-exit-btn",
];

function updatePauseFocus() {
  pauseControls.forEach((id) => {
    document.getElementById(id)?.classList.remove("controller-focus");
  });

  document
    .getElementById(pauseControls[pauseFocus])
    ?.classList.add("controller-focus");
}

function handlePauseMenu(button) {
  switch (button) {
    case BTN.DOWN:
      pauseFocus++;

      if (pauseFocus >= pauseControls.length) pauseFocus = 0;

      updatePauseFocus();
      Haptics.menu();

      break;

    case BTN.UP:
      pauseFocus--;

      if (pauseFocus < 0) pauseFocus = pauseControls.length - 1;

      updatePauseFocus();
      Haptics.menu();

      break;

    case BTN.A:
      document.getElementById(pauseControls[pauseFocus]).click();

      break;

    case BTN.B:

    case BTN.START:
      togglePause();

      Haptics.resume();

      break;
  }
}
