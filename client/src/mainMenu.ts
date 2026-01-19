import * as PIXI from "pixi.js";
import { IState, StateManager } from "./stateManager.js";
import { ClientState } from "../../game/util.js";

export enum MMSig {
  Join = "joinGame",
  JoinDevMode = "joinGameDevMode",
}
export class MainMenuState extends PIXI.EventEmitter implements IState {
  container = new PIXI.Container();
  devModeEnabled: boolean = false;
  private devModeCheckbox: PIXI.Graphics;
  private devModeCheckMark: PIXI.Graphics;

  constructor() {
    super();
    const introText = new PIXI.Text({
      text: "Safe As Houses",
      style: { fill: 0xffffff, fontSize: 24, fontFamily: "Courier" },
    });
    introText.y = -50;
    const button = new PIXI.Graphics().roundRect(0, 0, 200, 60, 15).fill({ color: 0x333333 });
    const text = new PIXI.Text({
      text: "Join Room",
      style: { fill: 0xffffff, fontSize: 20, fontFamily: "Courier" },
    });
    text.x = 50;
    text.y = 15;

    button.eventMode = "static";
    button.cursor = "pointer";
    button.on("pointertap", () => {
      if (this.devModeEnabled) {
        this.emit(MMSig.JoinDevMode);
      } else {
        this.emit(MMSig.Join);
      }
    });

    // Dev Mode Checkbox
    const devModeContainer = new PIXI.Container();
    devModeContainer.y = 80;
    
    this.devModeCheckbox = new PIXI.Graphics()
      .roundRect(0, 0, 20, 20, 3)
      .stroke({ color: 0xffffff, width: 2 });
    this.devModeCheckbox.eventMode = "static";
    this.devModeCheckbox.cursor = "pointer";
    
    this.devModeCheckMark = new PIXI.Graphics()
      .moveTo(4, 10)
      .lineTo(8, 14)
      .lineTo(16, 4)
      .stroke({ color: 0x00ff00, width: 3 });
    this.devModeCheckMark.visible = false;
    
    this.devModeCheckbox.on("pointertap", () => {
      this.devModeEnabled = !this.devModeEnabled;
      this.devModeCheckMark.visible = this.devModeEnabled;
    });
    
    const devModeLabel = new PIXI.Text({
      text: "Dev Mode (4 players, 1 tab)",
      style: { fill: 0xaaaaaa, fontSize: 14, fontFamily: "Courier" },
    });
    devModeLabel.x = 30;
    devModeLabel.y = 2;
    
    devModeContainer.addChild(this.devModeCheckbox, this.devModeCheckMark, devModeLabel);

    this.container.addChild(button, text, introText, devModeContainer);
    this.container.x = (1280 - 200) / 2; // adjust later for center
    this.container.y = (720 - 60) / 2;
  }

  enter(props?: Record<string, unknown>) {}
  exit() {}
}
