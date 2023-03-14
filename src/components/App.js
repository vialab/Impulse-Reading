import React, { Component, useState, useEffect } from 'react';
import { ipcRenderer } from 'electron';

import '../assets/css/App.css'

var gazePosition = { x: 0, y: 0 };
var cursor = '';

var delayedTransition = null;

var currentFixation = null;
var lastFixation = null;
var readingScore = 0;
var skimmingScore = 0;
var scanningScore = 0;
var inTask = false;
var manualControl = false;
var scrollLockout = 0;
var lastScrollPosition = 0;

var pointsWindow = [];

// Static constants for fixation transition types.
var READ_FORWARD = "READ_FORWARD";
var SKIM_FORWARD = "SKIM_FORWARD";
var LONG_SKIM_JUMP = "LONG_SKIM_JUMP";
var SHORT_REGRESSION = "SHORT_REGRESSION";
var LONG_REGRESSION = "LONG_REGRESSION";
var RESET_JUMP = "RESET_JUMP";
var UNCLASSIFIED_MOVE = "UNCLASSIFIED_MOVE";
var VERTICAL_JUMP = "VERTICAL_JUMP"
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
var REFRESH_RATE = 33;

var NEW_FIXATION_PX = 30;
var CURRENT_FIXATION_PX = 50;

var TASK_TIMER_IN_MS = 300000

// Hardcoded constants. This is beneficial during development to allow me to check the algorithm on text from external programs.
// However, in an ideal world finished product we would use some sort of OCR to change these constants.
var CHARACTER_WIDTH = 15;
var LINE_HEIGHT = 39;

var autoText;
var autoTextSkimming;
var autoTextScanning;

var manualText;
var manualTextSkimming;
var manualTextScanning;

var controlText;

var tutorialTextReading;
var tutorialTextSkimming;
var tutorialTextScanning;

var tutorialManualTextReading;
var tutorialManualTextSkimming;
var tutorialManualTextScanning;

var isTakingTutorialFast = false;
var isTakingTutorialSlow = false;
var slowForwardSaccades = [];
var fastForwardSaccades = [];
var skimForwardCharacterSpaces = 8; // This default gets changed to a calibrated value before it's actually used for anything.

var endTime = 0;

var dataLoggingArray = [];

export default class App extends Component {

  constructor(props) {
    super(props)
    this.state = {
      page: "TutorialIntro",
      currentMode: READING
    }

  }

  componentDidMount(){
    // Note that the main loop currently only runs when we receive a new gaze position.
    // This has the downside that we don't execute code while the user isn't looking at the screen.
    document.addEventListener('keydown', this.handleKeyUp.bind(this));
    document.addEventListener('scroll', this.handleScroll.bind(this));

    loadTextFiles();

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
      const newHighest = this.updateDetectors(transitionType, newFixation.changeX, newFixation.changeY);

      const DEBUGdiffXInChar = newFixation.changeX / CHARACTER_WIDTH;
      const DEBUGdiffYInLine = newFixation.changeY / LINE_HEIGHT;
      logData("diff x in Char: " + DEBUGdiffXInChar + " diffY in line: " + DEBUGdiffYInLine + " transition type: " + transitionType, "SACCADE");
    }
  }

  decayDetectors() {
    // The Tobii 5 has a 33hz rate, so if the user is constantly looking at the screen the decay will be:
    // 0.993^33 = 0.79x multiplier on the scores per second.
    // Based on this decay rate and the current constants, mode detector scores tend to cap out at about 50-100 for me.
    readingScore *=0.993;
    skimmingScore *=0.993;
    scanningScore *=0.993;

    if (scrollLockout > 0) {
      scrollLockout = scrollLockout - 1;
    }
  }

  checkFixation(x, y) {
    if (scrollLockout > 0) {
      this.endCurrentFixation();

      // Here we do NOT check for a new fixation, as the user is scrolling and we can't compare the old pixel values to the new ones.
      return null;
    }

    this.maintainWindowSize(x, y);

    if (!currentFixation) {
      return this.checkNewFixation();
    }
    else {
      return this.checkCurrentFixation(x, y);
    }
  }

  endCurrentFixation() {
    lastFixation = currentFixation;
    currentFixation = null;
  }

  maintainWindowSize(x, y) {
    if (pointsWindow.length >= WINDOW_SIZE) {
      pointsWindow.pop();
    }
    pointsWindow.unshift({x: x, y: y}); // unshift() adds an element to the beginning of the array.
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
      logData("Fixation maxX: " + maxX + " minX: " + minX + " maxY: " + maxY + " minY: " + minY, "FIXATION");

      // Calculate changeX and changeY
      if (lastFixation) {
        // There isn't a "true" center pixel for our fixation, but instead a sliding window based on which points have been sampled.
        // Estimate the middle of this fixation by taking the middle of the max and min for both x and y.
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
      // If any single point in the window is within the bounds of the fixation, the fixation is valid. Treat the others as outliers.
      const isPointOkay = (point) => this.checkPoint(point.x, point.y);
      const windowIsValid = pointsWindow.some(isPointOkay);

      if (!windowIsValid) {
        // This fixation has ended.
        this.endCurrentFixation();

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

      // This algorithm is really dumb, isn't it? comes straight from Buscher 2008, but it has no concept of outliers if you happen to be
      // within 50 px of the current fixation, meaning that a single outlier can peg the window significantly off of where it should be.
      // We probably could improve this, but we don't really care that much about every single saccade/fixation being 100% accurate.

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
    // At this point we have transitioned from our old fixation to the new one. Classify the type of transition based on its angle and distance.

    if (changeX == null || changeY == null) {
      return NO_TRANSITION;
    }

    else {
      const characterSpaces = changeX / CHARACTER_WIDTH;
      const lineSpaces = changeY / LINE_HEIGHT;

      if (lineSpaces > 2.5 || lineSpaces < -2.5) {
        return VERTICAL_JUMP;
      }

      // During the tutorials, we update the forward saccade calibration on non-vertical forward saccades.
      if (isTakingTutorialFast && 0 < characterSpaces) {
        this.updateCalibration(characterSpaces, true);
      }
      else if (isTakingTutorialSlow && 0 < characterSpaces) {
        this.updateCalibration(characterSpaces, false);
      }

      if (0 < characterSpaces && characterSpaces <= skimForwardCharacterSpaces) {
        return READ_FORWARD;
      }
      else if (0 < characterSpaces && characterSpaces <= 21) {
        return SKIM_FORWARD;
      }
      else if (0 < characterSpaces && characterSpaces <= 66) {
        // The max width here isn't very necessary, but if the jump is longer than the text is wide, it's probably not a real reading-related transition.
        // The original paper has this max at 30 for AFAICT similar reasons, but either they chose to set it pretty small or they had very narrow text.
        return LONG_SKIM_JUMP;
      }
      else if (-6 <= characterSpaces && characterSpaces < 0) {
        return SHORT_REGRESSION;
      }
      else if (-16 <= characterSpaces && characterSpaces < -6) {
        // Note that regressions still have a pretty short maximum length - less than half the length of the page.
        // True reading-related regressions rarely skip back to the beginning of the page.
        return LONG_REGRESSION;
      }
      else if (characterSpaces < -16 && lineSpaces > 0.6) {
        // The 0.6 isn't taken from the original paper - they just say "y according to line spacing". 0.6 seems to be a good middle ground between making it 
        // not trigger during the course of reading a line, while still catching reset jumps with some eye tracker variance.
        return RESET_JUMP;
      }
      else {
        return UNCLASSIFIED_MOVE;
      }
    }

  }

  updateCalibration(characterSpaces, isFast) {
    if (isFast) {
      fastForwardSaccades.push(characterSpaces);
    }
    else {
      slowForwardSaccades.push(characterSpaces);
    }
  }

  calculateForwardSaccadeLength() {
    // This function implements a simple but AFAICT novel technique for calibrating saccadic distances.

    // Saccadic distance varies heavily by person. For example, my reading saccades are something like 11 characters on average for reading,
    // and 13 characters on average for skimming. Jo's were about 5.5 and 6.5, and Celyn's were 6.5 and 8.
    // Clearly, any single number won't work. But the exact choice of number isn't super trivial, since the distributions for skimming and
    // reading overlap heavily and have a similar right-skewed distribution, differing only in their overall mean.
    // Buscher 2012 "personalizes" this metric by... personalizing the percentage of text read or skimmed... instead of actually personalizing
    // their reading/skimming detector. That won't work for our purposes (and honestly probably didn't work very well for theirs).

    // Instead, what we do is have the user skim about 1.5 pages of text, and read about 1 page of text. We track the average forward saccadic
    // distance for those texts, and average them. Then, we average those two numbers, and set that as our boundary between READ_FORWARD
    // and SKIM_FORWARD. This seems to work pretty well based on my testing, but is definitely ad-hoc. (But we should mention it as an improvement
    // we made over Buscher's SOTA, since their algorithm is pretty dumb.)

    if (!fastForwardSaccades.length || !slowForwardSaccades.length) {
      // No forward saccades at all were detected - this should hopefully only happen in development.
      skimForwardCharacterSpaces = 8;
      logData("Warning: calibration had no data and is exiting early. Setting boundary to 8 characters and continuing.", "WARNING", true);
      return;
    }

    let avgFast = this.arrayAverage(fastForwardSaccades);
    let avgSlow = this.arrayAverage(slowForwardSaccades);

    // If the averages differed significantly, that's great!
    if ((avgSlow + 1) <= avgFast) {
      skimForwardCharacterSpaces = this.average(avgFast, avgSlow);
    }
    else {
      // If they didn't, we're kinda in trouble. Let's hope this doesn't happen very often in our actual study, and mark when it does happen.
      skimForwardCharacterSpaces = avgSlow + 0.5;
      logData("Warning: calibration didn't find significant difference between skimming and reading.", "WARNING", true);
    }
    
    logData("Calibration complete - avg. fast: " + avgFast + ", avg slow: " + avgSlow + ", skim boundary: " + skimForwardCharacterSpaces, "EVENT", true);
  }

  arrayAverage(list) {
    return (list.reduce((prev, curr) => prev + curr) / list.length);
  }

  //transitionType: a static constant string from this class, representing which fixation transition type triggered this update.
  updateDetectors(transitionType, changeX, changeY) {

    // The scanning detector needs to have more logic than a simple +-, so we handle it here.
    if (transitionType == VERTICAL_JUMP) {
      return this.updateScanningDetector(transitionType, changeX, changeY);
    }

    // For each type, update the reading score, skimming score, and scanning score.
    switch(transitionType) {
      case READ_FORWARD: return this.changeDetectorScores(10, 5, 0);
      case SKIM_FORWARD: return this.changeDetectorScores(5, 10, 0);
      case LONG_SKIM_JUMP: return this.changeDetectorScores(-5, 8, 5);
      case SHORT_REGRESSION: return this.changeDetectorScores(-5, -5, -12); // Short regressions are rare during scanning, but more common in other types.
      case LONG_REGRESSION: return this.changeDetectorScores(-5, -3, -8);
      case RESET_JUMP: return this.changeDetectorScores(5, 5, -10); // Reading entire lines of text and then going to the next is rare in scanning.
      // case VERTICAL_JUMP: handled in if-statement above.
      case UNCLASSIFIED_MOVE: return this.changeDetectorScores(0, 0, 0);
    }

  }

  updateScanningDetector(transitionType, changeX, changeY) {
    // "one of the most expressive measures for relevance is coherently read text length, that
    // is, the length of text the user has read line by line without skipping any part"
    // -Buscher 2012. This is underdefined for our purposes since we're continous and the barrier between "skipping" and not is squishy.
    // We estimate this by simply incrementing our scanning detector on saccades that skip over or regress past multiple lines at once.

    // Scale the impact of this saccade by the amount of text skipped by this saccade.
    // Because we didn't hit one of the other types of detectors, changeY will be at least 2.5 lines skipped.

    var scoreChange = Math.abs(changeY) * 6;
    if (scoreChange > 25) {
      scoreChange = 25;
    }

    return this.changeDetectorScores(-5, -5, scoreChange);
  }

  changeDetectorScores(readChange, skimChange, scanChange) {
    readingScore+=readChange;
    skimmingScore+=skimChange;
    scanningScore+=scanChange;

    // In manual control we still update the model numbers in case that's useful for anything, but the actual state is set solely by user control.
    if (manualControl) {
      return this.state.currentMode;
    }

    const currentModeBonus = 10;

    if (this.state.currentMode == READING || !this.state.currentMode) {
      // When we're in a mode, treat its score as 10 points higher. This hysteris reduces the frequency of mode shifts during ambiguous behaviors.
      if (skimmingScore > (readingScore + currentModeBonus)) {

        this.setState({currentMode: SKIMMING});
        logData("Switching from reading to skimming", "MODE_SWITCH", true);

        // Make thrashing between different modes less likely; when we switch to a mode, temporarily boost its score.
        // We use a multiplicative score instead of an additive one so the momentum boost is less impactful
        // when the user is just starting out, and more impactful when they've been reading for at least a few seconds.
        skimmingScore *= 1.3;
        return this.state.currentMode;
      }
      else if (scanningScore > (readingScore + currentModeBonus)) {
        this.setState({currentMode: SCANNING});
        logData("Switching from reading to scanning", "MODE_SWITCH", true);
        scanningScore *= 1.3;
        return this.state.currentMode;
      }
    }
    else if (this.state.currentMode == SKIMMING) {
      if (readingScore > (skimmingScore + currentModeBonus)) {
        this.setState({currentMode: READING});
        logData("Switching from skimming to reading", "MODE_SWITCH", true);
        readingScore *= 1.3;
        return this.state.currentMode;
      }
      else if (scanningScore > (skimmingScore + currentModeBonus)) {
        this.setState({currentMode: SCANNING});
        logData("Switching from skimming to scanning", "MODE_SWITCH", true);
        scanningScore *= 1.3;
        return this.state.currentMode;
      }
    }
    else if (this.state.currentMode == SCANNING) {
      if (readingScore > (scanningScore + currentModeBonus)) {
        this.setState({currentMode: READING});
        logData("Switching from scanning to reading", "MODE_SWITCH", true);
        readingScore *= 1.3;
        return this.state.currentMode;
      }
      else if (skimmingScore > (scanningScore + currentModeBonus)) {
        this.setState({currentMode: SKIMMING});
        logData("Switching from scanning to skimming", "MODE_SWITCH", true);
        skimmingScore *= 1.3;
        return this.state.currentMode;
      }
    }

    return null;
  }

  handleKeyUp(event) {

    // Allow shortcuts to switch mode only when in manual control mode.
    if (manualControl) {
      if(event.ctrlKey && event.key === "1"){
        this.setModeManually(READING);
      }
      else if(event.ctrlKey && event.key === "2"){
        this.setModeManually(SKIMMING);
      }
      else if(event.ctrlKey && event.key === "3"){
        this.setModeManually(SCANNING);
      }
    }
  }

  setModeManually(newMode) {
    this.setState({currentMode: newMode});
    logData("Manually setting mode to: " + newMode, "MODE_SWITCH", true);
  }

  handleScroll(event) {

    // When scrolls occur, we should assume the current fixation is broken and lock the detectors for a bit - currently three frames of lockout.
    scrollLockout = Math.floor(REFRESH_RATE / 11);

    // Calculate the distance scrolled and increment the scanning detector, as fast scrolling is a sign of scanning.
    var last = lastScrollPosition;
    var doc = document.documentElement;
    var newScrollPosition = (window.pageYOffset || doc.scrollTop)  - (doc.clientTop || 0);

    var scrollDifferenceInPx = newScrollPosition - lastScrollPosition;
    scrollDifferenceInPx = Math.abs(scrollDifferenceInPx);

    lastScrollPosition = newScrollPosition;

    // E.g., scrolling 8 lines (~ a paragraph down) will mean an update of about 6-8 for the scanning detector.
    // This is a relatively minor portion of the scanning update in most cases, but
    // it allows us to set scanning while the user is scrolling quickly over the whole document.
    // Cap it at a maximum constant so that the scores don't go to extremes when scrolling over the entire document.
    if(scanningScore < 80) {
      var scanningDetectorChange = scrollDifferenceInPx / 40;
      this.changeDetectorScores(0, 0, scanningDetectorChange);
      logData("Scroll event. New position: " + newScrollPosition + ". Scanning detector change: " + scanningDetectorChange, "SCROLL");
    }
    else {
      logData("Scroll event. New position: " + newScrollPosition + ". Scanning score is already at maximum.", "SCROLL");
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
        </header>
        <div>
          {this.getPage(this.state.page, this.state.currentMode)}
        </div>
      </div>
    );
  }

  getPage(pageName, currentMode) {
    // We make the onClick callback functions in these functions, rather than in the Page classes, so that "this" refers to the App component.
    switch(pageName) {
      case "TutorialIntro":
          return this.createTutorialIntro();
          break;
      case "TutorialSkimming":
          return this.createTutorialSkimming();
          break;
      case "SkimmingExample":
          return this.createSkimmingExample();
          break;
      case "TutorialScanning":
          return this.createTutorialScanning();
          break;
      case "ScanningExample":
          return this.createScanningExample();
          break;
      case "TutorialReading":
          return this.createTutorialReading();
          break;
      case "ReadingExample":
          return this.createReadingExample();
          break;
      case "TutorialManual":
          return this.createTutorialManual(currentMode);
          break;
      case "AutoIntro":
          return this.createAutoIntro();
          break;
      case "AutoTask":
          return this.createAutoTask(currentMode);
          break;
      case "AutoQuestions":
          return this.createAutoQuestions();
          break;
      case "AutoSurvey":
          return this.createAutoSurvey();
          break;
      case "ManualInstructions":
          return this.createManualInstructions();
          break;
      case "ManualTask":
          return this.createManualTask(currentMode);
          break;
      case "ManualQuestions":
          return this.createManualQuestions();
          break;
      case "ManualSurvey":
          return this.createManualSurvey();
          break;
      case "ControlInstructions":
          return this.createControlInstructions();
          break;
      case "ControlTask":
          return this.createControlTask(currentMode);
          break;
      case "ControlQuestions":
          return this.createControlQuestions();
          break;
      case "EndSurvey":
          return this.createEndSurvey();
          break;
      case "EndPage":
          return this.createEndPage();
          break;
      default:
          return this.createTutorialSkimming();
    };
  }

  setPage(page) {
    this.setState({page: page});
    logData("Moving to page: " + page, "PAGE");
  }

  createTutorialIntro() {
    return (<TutorialIntro 
      onClick = {() => this.setPage("TutorialSkimming")}
    />);
  }

  createTutorialSkimming() {

    // Once the user clicks Next to go to the skimming example, we need to know we should start keeping track of forward saccades for calibration.
    let startExampleFunc = () => {
      this.setPage("SkimmingExample");
      isTakingTutorialFast = true;
    };

    return (<TutorialSkimming 
      onClick = {startExampleFunc}
    />);
  }

  createSkimmingExample() {
    
    // After the user clicks Next and leaves the skimming example, we should stop tracking forward saccades until the next chance for calibration.
    let endExampleFunc = () => {
      this.setPage("TutorialScanning");
      isTakingTutorialFast = false;
    };

    return (<SkimmingExample 
      onClick = {endExampleFunc}
    />);
  }

  createTutorialScanning() {
    let startExampleFunc = () => {
      this.setPage("ScanningExample");
      isTakingTutorialFast = true;
    };

    return (<TutorialScanning 
      onClick = {startExampleFunc}
    />);
  }

  createScanningExample() {
    let endExampleFunc = () => {
      this.setPage("TutorialReading");
      isTakingTutorialFast = false;
    };

    return (<ScanningExample 
      onClick = {endExampleFunc}
    />);
  }

  createTutorialReading() {
    let startExampleFunc = () => {
      this.setPage("ReadingExample");
      isTakingTutorialSlow = true;
    };

    return (<TutorialReading 
      onClick = {startExampleFunc}
    />);
  }

  createReadingExample() {
    let endExampleFunc = () => {
      this.setPage("TutorialManual");
      isTakingTutorialSlow = false;

      // At this point, we've received all our calibration data. Let's calculate the result of that calibration now.
      this.calculateForwardSaccadeLength();
    };

    return (<ReadingExample 
      onClick = {endExampleFunc}
    />);
  }

  createTutorialManual(currentMode) {
    manualControl = true;

    let readButtonFunc = () => {
      this.setModeManually(READING);
    }

    let skimButtonFunc = () => {
      this.setModeManually(SKIMMING);
    }

    let scanButtonFunc = () => {
      this.setModeManually(SCANNING);
    }

    return (<TutorialManual 
      onClick = {() => this.setPage("AutoIntro")}
      currentMode = {currentMode}
      readButtonFunc = {readButtonFunc}
      skimButtonFunc = {skimButtonFunc}
      scanButtonFunc = {scanButtonFunc}
    />);
  }

  createAutoIntro() {
    manualControl = false;

    return (<AutoIntro 
      onClick = {() => this.autoIntroOnClick()}
    />);
  }

  autoIntroOnClick() {
    inTask = true;
    
    // Always start the task in reading mode with a decent lead, so the user gets at least a couple seconds of unformatted text.
    this.setState({currentMode: READING});
    readingScore = 50;
    skimmingScore = 0;
    scanningScore = 0;


    const startTime = Date.now();
    endTime = startTime + TASK_TIMER_IN_MS; // endTime variable is used to show the timer. The actual page switch is determined by the setTimeout call.
    setTimeout(this.endTaskIfOngoing.bind(this), TASK_TIMER_IN_MS, "AutoQuestions");
    this.setPage("AutoTask");
  }

  endTaskIfOngoing(nextPage) {
    if (inTask) {
      logData("5 minute timer has elapsed and task is ending", "EVENT", true);
      this.setPage(nextPage);
      inTask = false;
    }
  }

  createAutoTask(currentMode) {
    return (<AutoTask
      onClick = {() => this.autoTaskOnClick()}
      currentMode = {currentMode}
    />);
  }

  autoTaskOnClick() {
    inTask = false;
    this.setPage("AutoQuestions");
  }

  createAutoQuestions() {

    const nextPageFunc = () => {

      const answerOne = document.querySelector('input[name="chinese-1"]:checked')?.value;
      const answerTwo = document.querySelector('input[name="chinese-2"]:checked')?.value;
      const answerThree = document.querySelector('input[name="chinese-3"]:checked')?.value;
      const answerFour = document.querySelector('input[name="chinese-4"]:checked')?.value;

      logData("Automatic condition, question 1 user answered: " + answerOne, "QUESTION", true);
      logData("Automatic condition, question 2 user answered: " + answerTwo, "QUESTION", true);
      logData("Automatic condition, question 3 user answered: " + answerThree, "QUESTION", true);
      logData("Automatic condition, question 4 user answered: " + answerFour, "QUESTION", true);

      this.setPage("AutoSurvey");
    }

    return (<AutoQuestions
      onClick = {nextPageFunc}
    />);
  }

  createAutoSurvey() {

    const nextPageFunc = () => {
      // TODO: log the usability question results here.

      this.setPage("ManualInstructions");
    }

    return (<AutoSurvey
      onClick = {nextPageFunc}
    />);
  }

  createManualInstructions(currentMode) {
    let onClickFunc = () => {
      inTask = true;
      this.setState({currentMode: READING});
    
      const startTime = Date.now();
      endTime = startTime + TASK_TIMER_IN_MS; // endTime variable is used to show the timer. The actual page switch is determined by the setTimeout call.
      setTimeout(this.endTaskIfOngoing.bind(this), TASK_TIMER_IN_MS, "ManualQuestions");
      this.setPage("ManualTask");
    }

    return (<ManualInstructions 
      onClick = {onClickFunc}
    />);
  }

  createManualTask(currentMode) {
    manualControl = true;

    let onClickFunc = () => {
      inTask = false;
      this.setPage("ManualQuestions");
    }

    let readButtonFunc = () => {
      this.setModeManually(READING);
    }

    let skimButtonFunc = () => {
      this.setModeManually(SKIMMING);
    }

    let scanButtonFunc = () => {
      this.setModeManually(SCANNING);
    }

    return (<ManualTask
      onClick = {onClickFunc}
      currentMode = {currentMode}
      readButtonFunc = {readButtonFunc}
      skimButtonFunc = {skimButtonFunc}
      scanButtonFunc = {scanButtonFunc}
    />);
  }

  createManualQuestions() {
    manualControl = false;

    const nextPageFunc = () => {

      const answerOne = document.querySelector('input[name="manual-1"]:checked')?.value;
      const answerTwo = document.querySelector('input[name="manual-2"]:checked')?.value;
      const answerThree = document.querySelector('input[name="manual-3"]:checked')?.value;
      const answerFour = document.querySelector('input[name="manual-4"]:checked')?.value;

      logData("Manual condition, question 1 user answered: " + answerOne, "QUESTION", true);
      logData("Manual condition, question 2 user answered: " + answerTwo, "QUESTION", true);
      logData("Manual condition, question 3 user answered: " + answerThree, "QUESTION", true);
      logData("Manual condition, question 4 user answered: " + answerFour, "QUESTION", true);

      this.setPage("ManualSurvey");
    }

    return (<ManualQuestions
      onClick = {nextPageFunc}
    />);
  }

  createManualSurvey() {

    const nextPageFunc = () => {
      // TODO: log the usability question results here.

      this.setPage("ControlInstructions");
    }

    return (<ManualSurvey
      onClick = {nextPageFunc}
    />);
  }

  createControlInstructions() {
    let onClickFunc = () => {
      inTask = true;
    
      const startTime = Date.now();
      endTime = startTime + TASK_TIMER_IN_MS; // endTime variable is used to show the timer. The actual page switch is determined by the setTimeout call.
      setTimeout(this.endTaskIfOngoing.bind(this), TASK_TIMER_IN_MS, "ControlQuestions");
      this.setPage("ControlTask");
    }

    return (<ControlInstructions 
      onClick = {onClickFunc}
    />);
  }

  createControlTask() {

    let onClickFunc = () => {
      inTask = false;
      this.setPage("ControlQuestions");
    }

    return (<ControlTask
      onClick = {onClickFunc}
    />);
  }

  createControlQuestions() {
    const nextPageFunc = () => {

      const answerOne = document.querySelector('input[name="control-1"]:checked')?.value;
      const answerTwo = document.querySelector('input[name="control-2"]:checked')?.value;
      const answerThree = document.querySelector('input[name="control-3"]:checked')?.value;
      const answerFour = document.querySelector('input[name="control-4"]:checked')?.value;

      logData("Control condition, question 1 user answered: " + answerOne, "QUESTION", true);
      logData("Control condition, question 2 user answered: " + answerTwo, "QUESTION", true);
      logData("Control condition, question 3 user answered: " + answerThree, "QUESTION", true);
      logData("Control condition, question 4 user answered: " + answerFour, "QUESTION", true);

      this.setPage("EndSurvey");
    }

    return (<ControlQuestions
      onClick = {nextPageFunc}
    />);
  }

  createEndSurvey() {
    const nextPageFunc = () => {
      const answerOne = document.querySelector('input[name="survey-1"]:checked')?.value;
      const answerTwo = document.querySelector('input[name="survey-2"]:checked')?.value;
      const answerThree = document.querySelector('input[name="survey-3"]:checked')?.value;
      const answerFour = document.getElementById('survey-text').value;

      logData("Post-study survey, question 1 user answered: " + answerOne, "QUESTION", true);
      logData("Post-study survey, question 2 user answered: " + answerTwo, "QUESTION", true);
      logData("Post-study survey, question 3 user answered: " + answerThree, "QUESTION", true);
      logData("Post-study survey, free text user answered: " + answerFour, "QUESTION", true);

      this.setPage("EndPage");
    }

    return (<EndSurvey
      onClick = {nextPageFunc}
    />);
  }

  createEndPage() {
    // This is the end of the experiment - let's write the log file now.
    writeLogFile();

    return (<EndPage
      onClick = {() => this.setPage("AutoIntro")}
    />);
  }
}

export class TutorialIntro extends Component {
  render() {
    return (
      <div className="App">
        <h2>Tutorial</h2>
        <div className='text'>
          <p className='text'>
            Thank you for agreeing to participate in today's study. Before we begin the tasks, we will do some brief tutorials on the
            software system you will be using today.

            We will begin the tutorials by showing you some different modes that the software system can use to format words on the screen.
            Each of these formats is intended to be useful, but they differ in which situation they are most useful for.
            After you have seen each of the modes, we will train you in two different ways of switching between the modes.
          </p>
          <p className='text'>
            Please let the researchers know if you need help at any point, or if you would like to take a break.
          </p>
        </div>
        <button className='button' onClick={this.props.onClick} >
          Next
        </button>
      </div>
    );
  }
}

export class TutorialSkimming extends Component {
  render() {
    return (
      <div className="App">
        <h2>Tutorial</h2>
        <div className='text'>
          <p className='text'>
            In today's study, you will read passages while searching for information. However, the passages you will read are quite long.
            Most people will not be able to fully read the text in the time given. Therefore, it is recommended
            to skim the text quickly to find the information you need, and to skip irrelevant parts of the passage.
            To help you read and find information more quickly, we have built a computer system that will format the text in certain ways.
          </p>
          <p className='text'>
            The first format is highlighting content words, like verbs, nouns, or adjectives. This has been scientifically shown to help with skimming
            a piece of text quickly. When you are ready, click "Next" to read a piece of text formatted in this way. There is no time limit and
            you may take as long as you want, but we ask that you try to skim the text quickly.
          </p>
        </div>
        <button className='button' onClick={this.props.onClick} >
          Next
        </button>
      </div>
    );
  }
}

export class SkimmingExample extends Component {

  // If this code is ever used for a user-facing application, we need to sanitize inputs for dangerouslySetInnerHTML().
  render() {

    var htmlText = tutorialTextSkimming;
      
    return (
      <div className="App">
        <h2>Ancient Egypt</h2>
        <p className='text' dangerouslySetInnerHTML={{__html: htmlText}}></p>
        <button className='button' onClick={this.props.onClick} >
          Next
        </button>
      </div>
    );
  }
}

export class TutorialScanning extends Component {
  render() {
    return (

      <div className="App">
        <h2>Tutorial</h2>
        <div className='text'>
          <p className='text'>
            The second format involves continually fading out sentences in a paragraph. This has been scientifically shown to help
            with reading over a text under time pressure. It is most useful for quickly skipping over paragraphs to get their main idea. However, if you
            are reading most of the words in a paragraph without skipping, the other modes may be more useful. 
          </p>
          <p className='text'>
            When you are ready, click "Next" to read a piece of text formatted in this way. There is no time limit and
            you may take as long as you want, but we ask that you try to skim the text quickly.
          </p>
        </div>
        <button className='button' onClick={this.props.onClick} >
          Next
        </button>
      </div>
    );
  }
}

export class ScanningExample extends Component {
  render() {

    var htmlText = tutorialTextScanning;

    return (
      <div className="App">
        <h2>Ancient Egypt</h2>
        <p className='text' dangerouslySetInnerHTML={{__html: htmlText}}></p>
        <button className='button' onClick={this.props.onClick} >
          Next
        </button>
      </div>
    );
  }
}

export class TutorialReading extends Component {
  render() {
    return (

      <div className="App">
        <h2>Tutorial</h2>
        <div className='text'>
          <p className='text'>
            The final format is normal text. All special formatting will be removed in this mode. This mode is most useful for reading
            text thoroughly. For example, this mode might be useful when you have found an important paragraph that you want to make sure you understand.
          </p>
          <p className='text'>
            For this passage, we ask that you try to read the text thoroughly. Try not to skim the passage or skip anything.
            When you're ready, click "Next" to read a piece of text formatted this way.
          </p>
        </div>
        <button className='button' onClick={this.props.onClick} >
          Next
        </button>
      </div>
    );
  }
}

export class ReadingExample extends Component {
  render() {

    var htmlText = tutorialTextReading;

    return (
      <div className="App">
        <h2>Ancient Egypt</h2>
        <p className='text' dangerouslySetInnerHTML={{__html: htmlText}}></p>
        <button className='button' onClick={this.props.onClick} >
          Next
        </button>
      </div>
    );
  }
}

export class TutorialManual extends Component {
  render() {

    var htmlText="";

    if (this.props.currentMode == READING) {
      htmlText = tutorialManualTextReading;
    }
    else if (this.props.currentMode == SKIMMING) {
      htmlText = tutorialManualTextSkimming;
    }
    else {
      htmlText = tutorialManualTextScanning;
    }


    return (

      <div className="App">
        <h2>Tutorial</h2>

        <div className="sidebar-buttons">
          <button className='button flex-button' onClick={this.props.readButtonFunc} >
            Remove Formatting
          </button>
          <button className='button flex-button' onClick={this.props.skimButtonFunc} >
            Highlight Content Words
          </button>
          <button className='button flex-button' onClick={this.props.scanButtonFunc} >
            Fadeout Sentences
          </button>
        </div>
        <div className='text'>
          <p className='text' dangerouslySetInnerHTML={{__html: htmlText}}></p>

        </div>
        <button className='button' onClick={this.props.onClick} >
          Next
        </button>
      </div>
    );
  }
}




export class AutoIntro extends Component {
  render() {
    return (

      <div className="App">
        <h2>Task 1</h2>
        <div className='text'>
          <p className='text'>
            For this task, you will be roleplaying as a high schooler writing a report on the effects of climate change in the Middle East.
            To do this, you will read a passage from Wikipedia about the settlement and development of Ancient Egypt.
            For your report, only some of the information in this passage will be useful:
            you will need to find information on <b>weather and climate</b> in Ancient Egypt, including information about climate change and
            climate events like floods or droughts. Any other information can be ignored.
            The text is quite long, so it is recommended to skim the text quickly to find the information you need.
          </p>
          <p className='text'>
            Once you begin, you will have 5 minutes to read. After these 5 minutes are up, we'll ask you some questions about the passage.
            You won't be able to go back to the passage once time is up, so do your best to read quickly and find the most relevant information.
            These questions will ask only about weather and climate in Ancient Egypt, so be on the lookout for those events.
          </p>
        </div>
        <button className='button' onClick={this.props.onClick} >
          Start
        </button>
      </div>
    );
  }
}

export class AutoTask extends Component {
  render() {

    let readingHtml = autoText;
    let skimmingHtml = autoTextSkimming;
    let scanningHtml = autoTextScanning;
    
    let readingClassName = (this.props.currentMode == READING ? "visible" : "");
    let skimmingClassName = (this.props.currentMode == SKIMMING ? "visible" : "");
    let scanningClassName =(this.props.currentMode == SCANNING ? "visible" : "");

    return (
      <div className="App">
        <div className="sidebar">
          <Timer text="Current task: Find info about <b>weather and climate</b>." />
        </div>
        <h2>Ancient Egypt</h2>
        <div className="relative">
          <p className={'text overlapping-text ' + readingClassName} dangerouslySetInnerHTML={{__html: autoText}}></p>
          <p className={'text overlapping-text ' + skimmingClassName} dangerouslySetInnerHTML={{__html: autoTextSkimming}}></p>
          <p className={'text overlapping-text ' + scanningClassName} dangerouslySetInnerHTML={{__html: autoTextScanning}}></p>
        </div>
        <button className='button bottom-right' onClick={this.props.onClick} >
          Move to Questions
        </button>
      </div>
    );
  }
}

export class AutoQuestions extends Component {

  // Creating ids/names clearly something that would be nice to do programmatically with a separate data file,
  // but I don't think that's the best use of development time for a one-off project.
  render() {
    return (
      <div className="App">
        <h2>Questions</h2>
        <p className='text'>
          Time is up for the first task. Before we move on, please answer the following comprehension questions about the passage you just read.
          <br />
          As a reminder, your performance is not being evaluated. It's okay if you don't know the answer to a question. You may leave questions blank if
          you don't wish to answer them or don't know the answer.
        </p>
        1.  What describes the Egyptian climate in Predynastic and Early Dynastic times?
        <div className="field">
          <input type="radio" id="chinese-1a" name="chinese-1" value="A"/>
          <label htmlFor="chinese-1a">The climate was much less arid than it is today, and covered in trees</label>
        </div>
        <div className="field">
          <input type="radio" id="chinese-1b" name="chinese-1" value="B"/>
          <label htmlFor="chinese-1b">The Nile River flooded more often, causing mass destruction in the small tribes of the area</label>
        </div>
        <div className="field">
          <input type="radio" id="chinese-1c" name="chinese-1" value="C"/>
          <label htmlFor="chinese-1c">The desert temperature was much cooler than in the Late Dynastic period</label>
        </div>
        <div className="field">
          <input type="radio" id="chinese-1d" name="chinese-1" value="D"/>
          <label htmlFor="chinese-1d">Droughts were common due to a mass aridification event</label>
        </div>
        <br />

        2. What seasons did the ancient Egyptians recognize?
        <div className="field">
          <input type="radio" id="chinese-2a" name="chinese-2" value="A"/>
          <label htmlFor="chinese-2a">Flooding, planting, and harvesting</label>
        </div>
        <div className="field">
          <input type="radio" id="chinese-2b" name="chinese-2" value="B"/>
          <label htmlFor="chinese-2b">Spring, summer, fall, and winter</label>
        </div>
        <div className="field">
          <input type="radio" id="chinese-2c" name="chinese-2" value="C"/>
          <label htmlFor="chinese-2c">Wet and dry</label>
        </div>
        <div className="field">
          <input type="radio" id="chinese-2d" name="chinese-2" value="D"/>
          <label htmlFor="chinese-2d">Inundation, Going Forth, and Deficiency</label>
        </div>
        <br />

        3. What climate events were belived to contribute to the period of famine and strife known as the First Intermediate Period?
        <div className="field">
          <input type="radio" id="chinese-3a" name="chinese-3" value="A"/>
          <label htmlFor="chinese-3a">Droughts</label>
        </div>
        <div className="field">
          <input type="radio" id="chinese-3b" name="chinese-3" value="B"/>
          <label htmlFor="chinese-3b">Sandstorms</label>
        </div>
        <div className="field">
          <input type="radio" id="chinese-3c" name="chinese-3" value="C"/>
          <label htmlFor="chinese-3c">Earthquakes</label>
        </div>
        <div className="field">
          <input type="radio" id="chinese-3d" name="chinese-3" value="D"/>
          <label htmlFor="chinese-3d">Flooding</label>
        </div>
        <br />

        4.  The ruler Amenemhat III's reign was marked by severe Nile floods. What effect did these floods have on his reign?
        <div className="field">
          <input type="radio" id="chinese-4a" name="chinese-4" value="A"/>
          <label htmlFor="chinese-4a">They strained the economy and precipitated a slow decline</label>
        </div>
        <div className="field">
          <input type="radio" id="chinese-4b" name="chinese-4" value="B"/>
          <label htmlFor="chinese-4b">They caused heightened unrest which led to a mass rebellion</label>
        </div>
        <div className="field">
          <input type="radio" id="chinese-4c" name="chinese-4" value="C"/>
          <label htmlFor="chinese-4c">They destroyed farmers' crops and caused a severe famine</label>
        </div>
        <div className="field">
          <input type="radio" id="chinese-4d" name="chinese-4" value="D"/>
          <label htmlFor="chinese-4d">They were seen as a sign of the god's disfavor, which forced Amenemhat III into exile</label>
        </div>
        <br />
        <button className='button' onClick={this.props.onClick} >
          Submit
        </button>
      </div>
      );
  }
}

export class AutoSurvey extends Component {
  render() {
    return (
      <div className="App">
        <h2>Survey</h2>
        <div className='text'>
          <p className='text'>
            Please answer the following questions about your experience in the task you just completed.
          </p>
          <p className='text'>
            TODO Questions will go here.
          </p>
        </div>
        <button className='button' onClick={this.props.onClick} >
          Next
        </button>
      </div>
    );
  }
}

export class ManualInstructions extends Component {
  render() {
    return (
      <div className="App">
        <h2>Task 2</h2>
        <div className='text'>
          <p className='text'>
            Thank you for your participation in the first task. Please let the researcher know if you would like a break, or if you have any questions.
          </p>
          <p className='text'>
            For this task, you will be roleplaying as a high schooler writing a report on historical events in 14th century China.
            To do this, you will read a passage from a Chinese history textbook about the events of the 1200s and 1300s.
            For your report, only some of the information in this passage will be useful:
            you will need to find information on <b>events in the 1300s</b>. Events that occured in the 1200s can be ignored.
            The text is quite long, so it is recommended to skim the text quickly to find the information you need.
          </p>
          <p className='text'>
            Once you begin, you will have 5 minutes to read. After these 5 minutes are up, we'll ask you some questions about the passage.
            You won't be able to go back to the passage once time is up, so do your best to read quickly and find the most relevant information.
            These questions will ask only about events in the 1300s, so be on the lookout for those events.
          </p>
        </div>
        <button className='button' onClick={this.props.onClick} >
          Start
        </button>
      </div>
    );
  }
}

export class ManualTask extends Component {
  render() {

    var htmlText = "";

    if (this.props.currentMode == READING) {
      htmlText = manualText;
    }
    else if (this.props.currentMode == SKIMMING) {
      htmlText = manualTextSkimming;
    }
    else {
      htmlText = manualTextScanning;
    }

    return (
      <div className="App">
        <div className="sidebar">
          <Timer text="Current task: Find info about <b>events in the 1300s</b>." />
        </div>

        <div className="sidebar-buttons">
          <button className='button flex-button' onClick={this.props.readButtonFunc} >
            Remove Formatting
          </button>
          <button className='button flex-button' onClick={this.props.skimButtonFunc} >
            Highlight Content Words
          </button>
          <button className='button flex-button' onClick={this.props.scanButtonFunc} >
            Fadeout Sentences
          </button>
        </div>

        <h2>Task 2</h2>
        <p className='text' dangerouslySetInnerHTML={{__html: htmlText}}></p>
        <button className='button bottom-right' onClick={this.props.onClick} >
          Move to Questions
        </button>
      </div>
    );
  }
}

export class ManualQuestions extends Component {
  render() {
    return (
      <div className="App">
        <h2>Questions</h2>
        <p className='text'>
          Time is up for the second task. Before we move on, please answer the following comprehension questions about the passage you just read.
          <br />
          As a reminder, your performance is not being evaluated. It's okay if you don't know the answer to a question. You may leave questions blank if
          you don't wish to answer them or don't know the answer.
        </p>
        1.  What actions did the popular risings of 1325 take?
        <div className="field">
          <input type="radio" id="manual-1a" name="manual-1" value="A"/>
          <label htmlFor="manual-1a">Attacking Mongols as alien invaders</label>
        </div>
        <div className="field">
          <input type="radio" id="manual-1b" name="manual-1" value="B"/>
          <label htmlFor="manual-1b">Protesting abuse from the newly appointed Mongol bureaucrats</label>
        </div>
        <div className="field">
          <input type="radio" id="manual-1c" name="manual-1" value="C"/>
          <label htmlFor="manual-1c">Attacking the rich in general and distributing their possessions</label>
        </div>
        <div className="field">
          <input type="radio" id="manual-1d" name="manual-1" value="D"/>
          <label htmlFor="manual-1d">Calling for a permanent state of Mongol rule over China</label>
        </div>
        <br />

        2. What characterized the soldiers of the Mongol military after 1320?
        <div className="field">
          <input type="radio" id="manual-2a" name="manual-2" value="A"/>
          <label htmlFor="manual-2a">Mongol soldiers were more effective than Chinese soldiers due to advanced technology</label>
        </div>
        <div className="field">
          <input type="radio" id="manual-2b" name="manual-2" value="B"/>
          <label htmlFor="manual-2b">They were aggressive and commonly led revolts</label>
        </div>
        <div className="field">
          <input type="radio" id="manual-2c" name="manual-2" value="C"/>
          <label htmlFor="manual-2c">The Mongol military mostly consisted of conscripted Chinese soldiers</label>
        </div>
        <div className="field">
          <input type="radio" id="manual-2d" name="manual-2" value="D"/>
          <label htmlFor="manual-2d">Most soldiers had never seen war and did not know how to use their weapons</label>
        </div>
        <br />

        3.  What occurred in response to the 1351 bursting of the dykes along the Yellow River?
        <div className="field">
          <input type="radio" id="manual-3a" name="manual-3" value="A"/>
          <label htmlFor="manual-3a">The government summoned forced laborers to reconstruct the dykes</label>
        </div>
        <div className="field">
          <input type="radio" id="manual-3b" name="manual-3" value="B"/>
          <label htmlFor="manual-3b">Rebel armies repaired the dykes against the orders of the government</label>
        </div>
        <div className="field">
          <input type="radio" id="manual-3c" name="manual-3" value="C"/>
          <label htmlFor="manual-3c">The government’s quick response led to improved relations with the Chinese</label>
        </div>
        <div className="field">
          <input type="radio" id="manual-3d" name="manual-3" value="D"/>
          <label htmlFor="manual-3d">The region of Honan was mostly destroyed by the resulting floods</label>
        </div>
        <br />

        4.  What relationship did the rebel Chu Yüan-chang have with the rich gentry?
        <div className="field">
          <input type="radio" id="manual-4a" name="manual-4" value="A"/>
          <label htmlFor="manual-4a">He became weak and ineffective as a leader due to their bribes</label>
        </div>
        <div className="field">
          <input type="radio" id="manual-4b" name="manual-4" value="B"/>
          <label htmlFor="manual-4b">He slaughtered them indiscriminately while capturing cities</label>
        </div>
        <div className="field">
          <input type="radio" id="manual-4c" name="manual-4" value="C"/>
          <label htmlFor="manual-4c">He allowed them to join him en masse</label>
        </div>
        <div className="field">
          <input type="radio" id="manual-4d" name="manual-4" value="D"/>
          <label htmlFor="manual-4d">He plundered their material wealth but allowed them to live in exile</label>
        </div>
        <br />
        <button className='button' onClick={this.props.onClick} >
          Submit
        </button>
      </div>
      );
  }
}

export class ManualSurvey extends Component {
  render() {
    return (
      <div className="App">
        <h2>Survey</h2>
        <div className='text'>
          <p className='text'>
            Please answer the following questions about your experience in the task you just completed.
          </p>
          <p className='text'>
            TODO Questions will go here.
          </p>
        </div>
        <button className='button' onClick={this.props.onClick} >
          Next
        </button>
      </div>
    );
  }
}

export class ControlInstructions extends Component {
  render() {
    return (
      <div className="App">
        <h2>Task 3</h2>
        <div className='text'>
          <p className='text'>
            Thank you for your participation. Please let the researcher know if you would like a break, or if you have any questions.
          </p>
          <p className='text'>
            TODO: control condition instructions.
          </p>
        </div>
        <button className='button' onClick={this.props.onClick} >
          Start
        </button>
      </div>
    );
  }
}

export class ControlTask extends Component {
  render() {

    controlText = "TODO control task text";
    var htmlText = controlText;

    return (
      <div className="App">
        <div className="sidebar">
          <Timer text="Current task: Find info about <b>TODO</b>." />
        </div>

        <h2>Task 3</h2>
        <p className='text' dangerouslySetInnerHTML={{__html: htmlText}}></p>
        <button className='button bottom-right' onClick={this.props.onClick} >
          Move to Questions
        </button>
      </div>
    );
  }
}

export class ControlQuestions extends Component {
  render() {
    return (
      <div className="App">
        <h2>Questions</h2>
        <p className='text'>
          Time is up for the third task. Before we move on, please answer the following comprehension questions about the passage you just read.
          <br />
          As a reminder, your performance is not being evaluated. It's okay if you don't know the answer to a question. You may leave questions blank if
          you don't wish to answer them or don't know the answer.
        </p>
        1.  Question1
        <div className="field">
          <input type="radio" id="control-1a" name="control-1" value="A"/>
          <label htmlFor="control-1a">Answer</label>
        </div>
        <div className="field">
          <input type="radio" id="control-1b" name="control-1" value="B"/>
          <label htmlFor="control-1b">Answer</label>
        </div>
        <div className="field">
          <input type="radio" id="control-1c" name="control-1" value="C"/>
          <label htmlFor="control-1c">Answer</label>
        </div>
        <div className="field">
          <input type="radio" id="control-1d" name="control-1" value="D"/>
          <label htmlFor="control-1d">Answer</label>
        </div>
        <br />

        2. Question2
        <div className="field">
          <input type="radio" id="control-2a" name="control-2" value="A"/>
          <label htmlFor="control-2a">Answer</label>
        </div>
        <div className="field">
          <input type="radio" id="control-2b" name="control-2" value="B"/>
          <label htmlFor="control-2b">Answer</label>
        </div>
        <div className="field">
          <input type="radio" id="control-2c" name="control-2" value="C"/>
          <label htmlFor="control-2c">Answer</label>
        </div>
        <div className="field">
          <input type="radio" id="control-2d" name="control-2" value="D"/>
          <label htmlFor="control-2d">Answer</label>
        </div>
        <br />

        3.  Question3
        <div className="field">
          <input type="radio" id="control-3a" name="control-3" value="A"/>
          <label htmlFor="control-3a">Answer</label>
        </div>
        <div className="field">
          <input type="radio" id="control-3b" name="control-3" value="B"/>
          <label htmlFor="control-3b">Answer</label>
        </div>
        <div className="field">
          <input type="radio" id="control-3c" name="control-3" value="C"/>
          <label htmlFor="control-3c">Answer</label>
        </div>
        <div className="field">
          <input type="radio" id="control-3d" name="control-3" value="D"/>
          <label htmlFor="control-3d">Answer</label>
        </div>
        <br />

        4.  Question4
        <div className="field">
          <input type="radio" id="control-4a" name="control-4" value="A"/>
          <label htmlFor="control-4a">Answer</label>
        </div>
        <div className="field">
          <input type="radio" id="control-4b" name="control-4" value="B"/>
          <label htmlFor="control-4b">Answer</label>
        </div>
        <div className="field">
          <input type="radio" id="control-4c" name="control-4" value="C"/>
          <label htmlFor="control-4c">Answer</label>
        </div>
        <div className="field">
          <input type="radio" id="control-4d" name="control-4" value="D"/>
          <label htmlFor="control-4d">Answer</label>
        </div>
        <br />
        <button className='button' onClick={this.props.onClick} >
          Submit
        </button>
      </div>
      );
  }
}

export class EndSurvey extends Component {
  render() {
    return (
      <div className="App">
        <h2>Survey</h2>
        <p className='text'>
          In today's study, two of the tasks used text formatting. During those tasks,
          we used two different techniques to switch the formatting of text. In the Manual Switching technique,
          you used buttons to switch the formatting at a time of your choosing. In the Automatic Switching technique, the computer system
          did its best to figure out which formatting was useful using eye tracking.
        </p>

        1.  Which technique did you like the most?
        <div className="field">
          <input type="radio" id="survey-1a" name="survey-1" value="Manual"/>
          <label htmlFor="survey-1a">Manual Switching</label>
        </div>
        <div className="field">
          <input type="radio" id="survey-1b" name="survey-1" value="Auto"/>
          <label htmlFor="survey-1b">Automatic Switching</label>
        </div>
        <div className="field">
          <input type="radio" id="survey-1c" name="survey-1" value="Same"/>
          <label htmlFor="survey-1c">Both were about the same</label>
        </div>
        <br />

        2.  Which technique do you feel made the task easier to complete?
        <div className="field">
          <input type="radio" id="survey-2a" name="survey-2" value="Manual"/>
          <label htmlFor="survey-2a">Manual Switching</label>
        </div>
        <div className="field">
          <input type="radio" id="survey-2b" name="survey-2" value="Auto"/>
          <label htmlFor="survey-2b">Automatic Switching</label>
        </div>
        <div className="field">
          <input type="radio" id="survey-2c" name="survey-2" value="Same"/>
          <label htmlFor="survey-2c">Both were about the same</label>
        </div>
        <br />

        3.  In which technique do you feel you were best able to answer the questions?
        <div className="field">
          <input type="radio" id="survey-3a" name="survey-3" value="Manual"/>
          <label htmlFor="survey-3a">Manual Switching</label>
        </div>
        <div className="field">
          <input type="radio" id="survey-3b" name="survey-3" value="Auto"/>
          <label htmlFor="survey-3b">Automatic Switching</label>
        </div>
        <div className="field">
          <input type="radio" id="survey-3c" name="survey-3" value="Same"/>
          <label htmlFor="survey-3c">Both were about the same</label>
        </div>
        <br />

        Do you have any other comments on your preference of technique?
        <textarea id="survey-text" rows="10" cols="30">
        </textarea> 
        <br />

        <button className='button' onClick={this.props.onClick} >
          Next
        </button>
      </div>
    );
  }
}

export class EndPage extends Component {
  render() {
    return (
      <div className="App">
        <h2>End of Study</h2>
        <p className='text'> Thank you for your participation in today's study! When you are ready, please see the researcher for the distribution of your remuneration.</p>
      </div>
    );
  }
}

export function Timer(props) {

  const initMinutes = ((TASK_TIMER_IN_MS / 1000 / 60) % 60)
  const initSeconds = ((TASK_TIMER_IN_MS / 1000) % 60)

  const [minutes, setMinutes] = useState(initMinutes);
  const [seconds, setSeconds] = useState(initSeconds);

  const getTime = () => {
    // Using Math.floor means that the timer has 1 second where it shows 0:00, instead of going straight to the quiz after 0:01. I think this is beneficial.
    const time = endTime - Date.now();
    setMinutes(Math.floor((time / 1000 / 60) % 60));
    setSeconds(Math.floor((time / 1000) % 60));
  };

  const text = props.text;

  // Minor issue here where the timer doesn't get updated on the first second, so it skips from 5:00 to 4:58. Not worth fixing.
  React.useEffect(() => {
    const interval = setInterval(() => getTime(endTime), 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="timer" role="timer">
      <div className="col-4">
        <div className="box">
          <p id="minute">Time remaining: {minutes}:{seconds < 10 ? "0" + seconds : seconds}</p>
          <p dangerouslySetInnerHTML={{__html: text}}></p>
        </div>
      </div>
    </div>
  );
}

export function logData(data, dataType = "GENERIC", consolePrint = false) {
  //format:
  //1519211809934 FIXATION: my message here

  const timestamp = Date.now();
  const logLine = timestamp + " " + dataType + ": " + data;
  dataLoggingArray.push(logLine);

  if (consolePrint) {
    console.log(data);
  }
}

export function writeLogFile() {
  // copy/pasted from first result on stackoverflow
  const fs = require("fs");

  const fileName = "./log_files/logfile_" + Date.now() + ".txt"
  const writeStream = fs.createWriteStream(fileName);
  const pathName = writeStream.path;
    
  // write each value of the array on the file breaking line
  dataLoggingArray.forEach(value => writeStream.write(`${value}\n`));

  // the finish event is emitted when all data has been flushed from the stream
  writeStream.on('finish', () => {
     console.log(`wrote all the array data to file ${pathName}`);
  });

  // handle the errors on the write process
  writeStream.on('error', (err) => {
      console.error(`There is an error writing the file ${pathName} => ${err}`)
  });

  // close the stream
  writeStream.end();
}

export function loadTextFiles() {
  const fs = require("fs");
    const autoReadingPath = './nlp_files/egyptian_climate.txt'; // Put this filename in a variable so we can enforce a log of the correct name

    fs.readFile(autoReadingPath, {encoding: 'utf8'}, function (err, data) {
      if (err) {
        return console.error(err);
      }
      else {
        autoText = data.toString();
        autoText = autoText.replace(/\n/g, "<br />");
        logData("Text for auto mode: " + autoReadingPath, "FILENAME");
      }
    });

    fs.readFile('./nlp_files/edited_egyptian_climate.txt', {encoding: 'utf8'}, function (err, data) {
      if (err) {
        return console.error(err);
      }
      else {
        autoTextSkimming = data.toString();
        autoTextSkimming = autoTextSkimming.replace(/\n/g, "<br />");
      }
    });

    fs.readFile('./nlp_files/fadeout_egyptian_climate.txt', {encoding: 'utf8'}, function (err, data) {
      if (err) {
        return console.error(err);
      }
      else {
        autoTextScanning = data.toString();
        autoTextScanning = autoTextScanning.replace(/\n/g, "<br />");
      }
    });

    const manualReadingPath = './nlp_files/chinese_history.txt';

    fs.readFile(manualReadingPath, {encoding: 'utf8'}, function (err, data) {
      if (err) {
        return console.error(err);
      }
      else {
        manualText = data.toString();
        manualText = manualText.replace(/\n/g, "<br />");
        logData("Text for manual mode: " + manualReadingPath, "FILENAME");
      }
    });

    fs.readFile('./nlp_files/edited_chinese_history.txt', {encoding: 'utf8'}, function (err, data) {
      if (err) {
        return console.error(err);
      }
      else {
        manualTextSkimming = data.toString();
        manualTextSkimming = manualTextSkimming.replace(/\n/g, "<br />");
      }
    });

    fs.readFile('./nlp_files/fadeout_chinese_history.txt', {encoding: 'utf8'}, function (err, data) {
      if (err) {
        return console.error(err);
      }
      else {
        manualTextScanning = data.toString();
        manualTextScanning = manualTextScanning.replace(/\n/g, "<br />");
      }
    });

    fs.readFile('./nlp_files/tutorial_text/reading.txt', {encoding: 'utf8'}, function (err, data) {
      if (err) {
        return console.error(err);
      }
      else {
        tutorialTextReading = data.toString();
        tutorialTextReading = tutorialTextReading.replace(/\n/g, "<br />");
      }
    });

    fs.readFile('./nlp_files/tutorial_text/skimming.txt', {encoding: 'utf8'}, function (err, data) {
      if (err) {
        return console.error(err);
      }
      else {
        tutorialTextSkimming = data.toString();
        tutorialTextSkimming = tutorialTextSkimming.replace(/\n/g, "<br />");
      }
    });

    fs.readFile('./nlp_files/tutorial_text/scanning.txt', {encoding: 'utf8'}, function (err, data) {
      if (err) {
        return console.error(err);
      }
      else {
        tutorialTextScanning = data.toString();
        tutorialTextScanning = tutorialTextScanning.replace(/\n/g, "<br />");
      }
    });

    fs.readFile('./nlp_files/tutorial_text/manual_reading.txt', {encoding: 'utf8'}, function (err, data) {
      if (err) {
        return console.error(err);
      }
      else {
        tutorialManualTextReading = data.toString();
        tutorialManualTextReading = tutorialManualTextReading.replace(/\n/g, "<br />");
      }
    });

    fs.readFile('./nlp_files/tutorial_text/manual_skimming.txt', {encoding: 'utf8'}, function (err, data) {
      if (err) {
        return console.error(err);
      }
      else {
        tutorialManualTextSkimming = data.toString();
        tutorialManualTextSkimming = tutorialManualTextSkimming.replace(/\n/g, "<br />");
      }
    });

    fs.readFile('./nlp_files/tutorial_text/manual_scanning.txt', {encoding: 'utf8'}, function (err, data) {
      if (err) {
        return console.error(err);
      }
      else {
        tutorialManualTextScanning = data.toString();
        tutorialManualTextScanning = tutorialManualTextScanning.replace(/\n/g, "<br />");
      }
    });
}