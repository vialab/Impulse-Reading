import React, { Component } from 'react';
import { ipcRenderer } from 'electron';

import '../assets/css/App.css'

var gazePosition = { x: 0, y: 0 };
var cursor = '';

var delayedTransition = null;

// TODO: consider whether we want to do this more functionally
var currentFixation = null;
var lastFixation = null;
var readingScore = 0;
var skimmingScore = 0;
var scanningScore = 0;
var currentMode = READING;

var pointsWindow = [];

// Static constants for fixation transition types.
var READ_FORWARD = "READ_FORWARD";
var SKIM_FORWARD = "SKIM_FORWARD";
var LONG_SKIM_JUMP = "LONG_SKIM_JUMP";
var SHORT_REGRESSION = "SHORT_REGRESSION";
var LONG_REGRESSION = "LONG_REGRESSION";
var RESET_JUMP = "RESET_JUMP";
var UNCLASSIFIED_MOVE = "UNCLASSIFIED_MOVE";
var NO_TRANSITION = "NO_TRANSITION";

var READING = "READING";
var SKIMMING = "SKIMMING";
var SCANNING = "SCANNING";

// The window size required to make a fixation. The Tobii 5 has a sample rate of 33hz, meaning that a window of 3 points
// is approximately (1/33)*3 = 0.091 seconds, or 91 ms. Fixations usually last 200+ ms, so this SHOULD be enough to reliably
// detect fixations. However, we can still miss fixations if an outlier happens in the middle of the fixation.
// If this code is adapted to an eye tracker with a different sample rate, this window should be adjusted such that the formula:
// (1/SAMPLE_RATE)*WINDOW_SIZE
// equals... something less than 100 ms, and probably more than 30 ms or so, but that's just based on a gut feeling.
var WINDOW_SIZE = 3;

var NEW_FIXATION_PX = 30;
var CURRENT_FIXATION_PX = 50;

// Hardcoded constants. This is beneficial during development to allow me to check the algorithm on text from external programs.
// However, in an ideal world finished product we would use some sort of OCR to change these constants.
// These are currently set to what feels roughly correct to me for small wikipedia text.
// THese should DEFINITELY be changed over the course of some user tests / pilot studies before being deployed.
var CHARACTER_WIDTH = 12; //TODO
var LINE_HEIGHT = 15; //TODO

export default class App extends Component {

  constructor(props) {
    super(props)
    this.state = {
      gazeCursorEnabled: true
    }

  }

  componentDidMount(){
    //exampleFunc();


    ipcRenderer.on('gaze-pos', (event, arg) => {
      this.mainLoop(arg.x, arg.y);
    });
  }

  mainLoop(x, y) {
    
    //Constant exponential falloff of all detector scores.
    this.decayDetectors();
    // Check current gaze location to see if it corresponds to a new fixation, and delete the current fixation if it's ended.
    const newFixation = this.checkFixation(x, y);
 
    if (newFixation) {
      // Classify the transition between the old fixation and the new fixation.
      const transitionType = this.classifyTransition(newFixation.changeX, newFixation.changeY);

      // Based on our transition, update our detectors.
      // TODO: refactor this to allow for a delayed transition / "cooldown period".
      const newHighest = this.updateDetectors(transitionType);

      const DEBUGdiffXInChar = newFixation.changeX / CHARACTER_WIDTH;
      const DEBUGdiffYInLine = newFixation.changeY / LINE_HEIGHT;
      console.log("new fixation, transition type: " + transitionType + ". diff x in Char: " + DEBUGdiffXInChar + " diffY in line: " + DEBUGdiffYInLine);
      // If our detector updates led to a new highest candidate, transition to a new mode.
      if (newHighest) {
        this.changeMode(newHighest);
      }
    }

    
  }

  decayDetectors() {
    //TOOD: add comment documentation here of how much this decays per second. Also, change the constants.
    //0.99^50 = 0.605. Probably too fast, currently?
    readingScore *=0.99;
    skimmingScore *=0.99;
    scanningScore *=0.99;
  }

  checkFixation(x, y) {
    this.maintainWindowSize(x, y);

    if (!currentFixation) {
      return this.checkNewFixation();
    }
    else {
      return this.checkCurrentFixation(x, y);
    }
  }

  maintainWindowSize(x, y) {
    if (pointsWindow.length >= WINDOW_SIZE) {
      pointsWindow.pop();
    }
    pointsWindow.unshift({x: x, y: y});
  }

  checkNewFixation() {
    const maxX = Math.max(...pointsWindow.map(point => point.x));
    const minX = Math.min(...pointsWindow.map(point => point.x));
    const maxY = Math.max(...pointsWindow.map(point => point.y));
    const minY = Math.min(...pointsWindow.map(point => point.y));
    const diffX = maxX - minX;
    const diffY = maxY - minY;

    if (diffX <= NEW_FIXATION_PX && diffY <= NEW_FIXATION_PX) {
      // This is a new fixation, because all of the points in the window are close to each other.
      currentFixation = {maxX: maxX, minX: minX, maxY: maxY, minY: minY};

      // Calculate changeX and changeY
      if (lastFixation) {
        currentFixation.changeX = this.average(maxX, minX) - this.average(lastFixation.maxX, lastFixation.minX);
        currentFixation.changeY = this.average(maxY, minY) - this.average(lastFixation.maxY, lastFixation.minY);
      }

      return currentFixation;
    }
    else {
      return null;
    }
  }

  average(a, b) {
    return (a+b)/2;
  }

  checkCurrentFixation(x, y) {
    const withinFixation = this.checkPoint(x, y);
    if (!withinFixation) {

      // This point was outside the fixation, but it might be an outlier.
      // If any point in the window is okay, the fixation is okay. Treat the others as outliers.
      const isPointOkay = (point) => this.checkPoint(point.x, point.y);
      const isWindowOkay = pointsWindow.some(isPointOkay);

      if (!isWindowOkay) {
        // This fixation has ended.
        lastFixation = currentFixation;
        currentFixation = null;

        // If the window represents a new fixation that should replace the old one, return the new fixation.
        return this.checkNewFixation();
      }
      else {
        // This point was an outlier, but the fixation is still okay for now. Return null because there's no new fixation.
        return null;
      }
      
    }
    else {
      // This point was in the current fixation. Update this fixation, and return null because there's no new fixation.

      //TODO: this algorithm is really dumb, isn't it? comes straight from the paper, but it has no concept of outliers if you happen to be
      // within 50 px of the current fixation, meaning that a single outlier can peg the window significantly off of where it should be.

      currentFixation.maxX = withinFixation.candidateMaxX;
      currentFixation.minX = withinFixation.candidateMinX;
      currentFixation.maxY = withinFixation.candidateMaxY;
      currentFixation.minY = withinFixation.candidateMinY;
      return null;
    }
  }

  // Returns the updated values of the current fixation if this point is okay, and null if this point isn't okay.
  checkPoint(x, y) {
    var val = {
      candidateMaxX: Math.max(currentFixation.maxX, x),
      candidateMinX: Math.min(currentFixation.minX, x),
      candidateMaxY: Math.max(currentFixation.maxY, y),
      candidateMinY: Math.min(currentFixation.minY, y),
    }
    val.diffX = val.candidateMaxX - val.candidateMinX;
    val.diffY = val.candidateMaxY - val.candidateMinY;
    if (val.diffX < CURRENT_FIXATION_PX && val.diffY < CURRENT_FIXATION_PX) {
      return val;
    }
    else {
      return null;
    }
  }



  classifyTransition(changeX, changeY) {
    if (changeX == null || changeY == null) {
      return NO_TRANSITION;
    }

    else {
      const characterSpaces = changeX / CHARACTER_WIDTH;
      const lineSpaces = changeY / LINE_HEIGHT;

      if (0 < characterSpaces && characterSpaces <= 11) {
        return READ_FORWARD;
      }
      else if (0 < characterSpaces && characterSpaces <= 21) {
        return SKIM_FORWARD;
      }
      else if (0 < characterSpaces && characterSpaces <= 50) {
        return LONG_SKIM_JUMP; // TODO: I changed the max from 30 to 50 because I suspect it's dumb, but take a look at this
      }
      else if (-6 <= characterSpaces && characterSpaces < 0) {
        return SHORT_REGRESSION;
      }
      else if (-16 <= characterSpaces && characterSpaces < -6) {
        return LONG_REGRESSION;
      }
      else if (characterSpaces < -16 && lineSpaces > 0.8) {
        return RESET_JUMP; // TODO: totally guessing on the 0.8 here. Paper just says "y according to line spacing".
      }
      else {
        return UNCLASSIFIED_MOVE;
      }
    }

  }

  //transitionType: a static constant string from this class, representing which fixation transition type triggered this update.
  updateDetectors(transitionType) {
    //TODO: implement scanning detector.

    // For each type, update the reading score, skimming score, and scanning score.
    switch(transitionType) {
      case READ_FORWARD: return this.changeDetectorScores(10, 5, 0);
      case SKIM_FORWARD: return this.changeDetectorScores(5, 10, 0);
      case LONG_SKIM_JUMP: return this.changeDetectorScores(-5, 8, 0);
      case SHORT_REGRESSION: return this.changeDetectorScores(-8, -8, 0);
      case LONG_REGRESSION: return this.changeDetectorScores(-5, -3, 0);
      case RESET_JUMP: return this.changeDetectorScores(5, 5, 0);
      case UNCLASSIFIED_MOVE: return this.changeDetectorScores(0, 0, 0);
    }

  }

  changeDetectorScores(readChange, skimChange, scanChange) {
    readingScore+=readChange;
    skimmingScore+=skimChange;
    scanningScore+=scanChange;
    console.log(" reading: " + readingScore + "skimming: " + skimmingScore);

    // TODO: implement scanning. Also geez refactor this to abstract it away from doing each comparison directly
    // e.g. "if highest.mode != currentMode: ""
    if (currentMode == READING || !currentMode) {
      if (skimmingScore > readingScore) {
        currentMode = SKIMMING;
        return currentMode;
      }
    }
    else if (currentMode == SKIMMING) {
      if (readingScore > skimmingScore) {
        currentMode = READING;
        return currentMode;
      }
    }
    return null;
  }

  changeMode(newHighest) {
    // Check for collision between eye gaze cursor and items

    let element = document.getElementById("square");
    let text = document.getElementById("text");

    if (currentMode == READING) {
      element.style.backgroundColor = "coral";
      text.textContent = "Reading!";
    }
    else if (currentMode == SKIMMING) {
      element.style.backgroundColor = "skyblue";
      text.textContent = "Skimming!";
    }
  }


  componentDidUpdate(){

  }

  componentWillUnmount() {

  }

  render() {
    return (
      <div className="App" key={this.state.activeDemo}>
        <header className="App-header">
          <div id="gazeCursor"></div>
        </header>
        <div className='container'>
          <div id='square'>
            <p id="text">Look at me!</p>
          </div>
        </div>
      </div>
    );
  }

  //TODO: delete me
  exampleFunc() {
    // Receive gaze-pos message from backend
    ipcRenderer.on('gaze-pos', (event, arg) => {

      if (this.state.gazeCursorEnabled) {
        if (cursor === '') {
          cursor = document.getElementById("gazeCursor");
        }
        cursor.style.visibility = "visible";
        gazePosition.x = arg.x;
        gazePosition.y = arg.y;

        // Update gaze cursor position
        cursor.style.left = gazePosition.x + "px";
        cursor.style.top = gazePosition.y + "px";

        // Check collisions
        this.checkCollision();
      }
      else {
        cursor = document.getElementById("gazeCursor");
        cursor.style.visibility = "hidden";
      }

    });
  }

  //TODO: delete me
   checkCollision() {
    // Check for collision between eye gaze cursor and items
    let cursor = document.getElementById("gazeCursor");
    let cursorCoord = cursor.getBoundingClientRect();
    let element = document.getElementById("square");
    let elementCoord = element.getBoundingClientRect();
    let text = document.getElementById("text");

    if (cursorCoord.left < elementCoord.left + elementCoord.width && cursorCoord.left + cursorCoord.width > elementCoord.left &&
      cursorCoord.top < elementCoord.top + elementCoord.height && cursorCoord.top + cursorCoord.height > elementCoord.top) {
        // Collision detected
        element.style.backgroundColor = "coral";
        text.textContent = "Gaze detected";

        if(Math.floor(Math.random() * 10) < 5) {
          text.textContent = "Esports!";
        }
        
    }
    else {
      element.style.backgroundColor = "skyblue";
      text.textContent = "Look at me!";
    }

  }

}
