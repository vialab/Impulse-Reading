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

var testText = "test text";
var testTextEdited = "test text edited"
var testTextSentences = "test text sentences"

var tutorialTextReading;
var tutorialTextSkimming;
var tutorialTextScanning;

var isTakingTutorialFast = false;
var isTakingTutorialSlow = false;
var slowForwardSaccades = [];
var fastForwardSaccades = [];
var skimForwardCharacterSpaces = 8; // This default gets changed to a calibrated value before it's actually used for anything.

var endTime = 0;

export default class App extends Component {

  constructor(props) {
    super(props)
    this.state = {
      gazeCursorEnabled: true,
      page: "TutorialSkimming",
      currentMode: READING
    }

  }

  componentDidMount(){
    // Note that the main loop currently only runs when we receive a new gaze position.
    // This has the downside that we don't execute code while the user isn't looking at the screen.
    document.addEventListener('keydown', this.handleKeyUp.bind(this));
    document.addEventListener('scroll', this.handleScroll.bind(this));

    const fs = require("fs");

    fs.readFile('./nlp_files/egyptian_climate.txt', {encoding: 'utf8'}, function (err, data) {
      if (err) {
        return console.error(err);
      }
      else {
        testText = data.toString();
        testText = testText.replace(/\n/g, "<br />");
      }
    });

    fs.readFile('./nlp_files/edited_egyptian_climate.txt', {encoding: 'utf8'}, function (err, data) {
      if (err) {
        return console.error(err);
      }
      else {
        testTextEdited = data.toString();
        testTextEdited = testTextEdited.replace(/\n/g, "<br />");
      }
    });

    fs.readFile('./nlp_files/egyptian_climate_smmry.txt', {encoding: 'utf8'}, function (err, data) {
      if (err) {
        return console.error(err);
      }
      else {
        testTextSentences = data.toString();
        testTextSentences = testTextSentences.replace(/\n/g, "<br />");
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

      //console.log("transition type: " + transitionType);

      //console.log("diff x in Char: " + DEBUGdiffXInChar + " diffY in line: " + DEBUGdiffYInLine);
      
    
    }

    
  }

  decayDetectors() {
    // The Tobii 5 has a 33hz rate, so if the user is constantly looking at the screen the decay will be:
    // 0.99^33 = 0.72x multiplier on the scores per second.
    // Based on this decay rate and the current constants, mode detector scores tend to cap out at about 50-100 for me.
    readingScore *=0.99;
    skimmingScore *=0.99;
    scanningScore *=0.99;

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
      // If any point in the window is okay, the fixation is okay. Treat the others as outliers.
      const isPointOkay = (point) => this.checkPoint(point.x, point.y);
      const isWindowOkay = pointsWindow.some(isPointOkay);

      if (!isWindowOkay) {
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

      //This algorithm is really dumb, isn't it? comes straight from the paper, but it has no concept of outliers if you happen to be
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
    // Saccadic distance varies heavily by person. For example, my reading saccades are something like 11 characters on average for reading,
    // and 13 characters on average for skimming. Jo's were about 5.5 and 6.5, and Celyn's were 6.5 and 8.
    // Clearly, any single number won't work. But the exact choice of number isn't super trivial, since the distributions for skimming and
    // scanning overlap heavily and have a similar right-skewed distribution, differing only in their overall mean.
    // Busch 2012 "personalizes" this metric by... personalizing the percentage of text read or skimmed... instead of actually personalizing
    // their reading/skimming detector. That won't work for our purposes (and honestly probably didn't work very well for theirs).

    // Instead, what we do is have the user skim about 1.5 pages of text, and read about 1 page of text. We track the average forward saccadic
    // distance for those texts, and average them. Then, we average those two numbers, and set that as our boundary between READ_FORWARD
    // and SKIM_FORWARD. This seems to work pretty well based on my testing, but is definitely ad-hoc. (But we should mention it as an improvement
    // we made over Busch's SOTA, since their algorithm is pretty dumb.)

    let avgFast = this.arrayAverage(fastForwardSaccades);
    let avgSlow = this.arrayAverage(slowForwardSaccades);

    // If the averages differed significantly, that's great!
    if ((avgSlow + 1) <= avgFast) {
      skimForwardCharacterSpaces = this.average(avgFast, avgSlow);
    }
    else {
      // If they didn't, we're kinda in trouble. Let's hope this doesn't happen very often in our actual study, and mark when it does happen.
      skimForwardCharacterSpaces = avgSlow + 0.5;
      console.log("WARNING: calibration didn't find significant difference between skimming and reading.");
    }
    
    console.log("Calibration complete - avg. fast: " + avgFast + ", avg slow: " + avgSlow + ", skim boundary: " + skimForwardCharacterSpaces);
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
      case LONG_SKIM_JUMP: return this.changeDetectorScores(-5, 8, 0);
      case SHORT_REGRESSION: return this.changeDetectorScores(-5, -5, -12); // Short regressions are rare during scanning, but more common in other types.
      case LONG_REGRESSION: return this.changeDetectorScores(-5, -3, 0);
      case RESET_JUMP: return this.changeDetectorScores(5, 5, -10); // Reading entire lines of text and then going to the next is rare in scanning.
      // case VERTICAL_JUMP: handled in if-statement above.
      case UNCLASSIFIED_MOVE: return this.changeDetectorScores(0, 0, 0);
    }

  }

  updateScanningDetector(transitionType, changeX, changeY) {
    // If there's been a lot of reset jumps in the last little bit, we're probably reading or skimming.
    // If we have a large vertical jump, or several vertical jumps in a row, we're more likely to be scanning.
    // "one of the most expressive measures for relevance is coherently read text length, that
    // is, the length of text the user has read line by line without skipping any part"

    // Maintain a 10 second window, and compare the number of lines that have been skipped versus read in those seconds. switch on a percentage.
    // Maintain a virtual window with exponential falloff (same as other scores). Estimate number of lines that have been skipped versus read. switch on a score.

    // Scale the impact of this saccade by the amount of text skipped by this saccade.
    // Because we didn't hit one of the other types of detectors, changeY will be at least ~2 lines skipped.

    var scoreChange = Math.abs(changeY) * 5;
    if (scoreChange > 25) {
      scoreChange = 25;
    }

    return this.changeDetectorScores(-5, -5, scoreChange);
  }

  changeDetectorScores(readChange, skimChange, scanChange) {
    readingScore+=readChange;
    skimmingScore+=skimChange;
    scanningScore+=scanChange;
    //console.log(" reading: " + readingScore + " skimming: " + skimmingScore + " scanning: " + scanningScore);

    if (this.state.currentMode == READING || !this.state.currentMode) {
      // When we're in a mode, treat its score as 10 points higher. This hysteris reduces the frequency of mode shifts during ambiguous behaviors.
      if (skimmingScore > (readingScore+10)) {

        // React will call render(), which will update the user-facing HTML if needed.
        this.setState({currentMode: SKIMMING});

        // Make thrashing between different modes less likely; when we switch to a mode, temporarily boost its score.
        // We use a multiplicative score instead of an additive one so the momentum boost is less impactful
        // when the user is just starting out, and more impactful when they've been reading for at least a few seconds.
        skimmingScore *= 1.3;
        return this.state.currentMode;
      }
      else if (scanningScore > (readingScore+10)) {
        this.setState({currentMode: SCANNING});
        scanningScore *= 1.3;
        return this.state.currentMode;
      }
    }
    else if (this.state.currentMode == SKIMMING) {
      if (readingScore > (skimmingScore+10)) {
        this.setState({currentMode: READING});
        readingScore *= 1.3;
        return this.state.currentMode;
      }
      else if (scanningScore > (skimmingScore+10)) {
        this.setState({currentMode: SCANNING});
        scanningScore *= 1.3;
        return this.state.currentMode;
      }
    }
    else if (this.state.currentMode == SCANNING) {
      if (readingScore > (scanningScore+10)) {
        this.setState({currentMode: READING});
        readingScore *= 1.3;
        return this.state.currentMode;
      }
      else if (skimmingScore > (scanningScore+10)) {
        this.setState({currentMode: SKIMMING});
        scanningScore *= 1.3;
        return this.state.currentMode;
      }
    }

    return null;
  }

  handleKeyUp(event) {

    if(event.ctrlKey && event.key === "1"){
      console.log("Switching to mode 1!");
    }
    else if(event.ctrlKey && event.key === "2"){
      console.log("Switching mode 2!");
    }
    else if(event.ctrlKey && event.key === "3"){
      console.log("Switching mode 3!");
    }
  }

  handleScroll(event) {

    var last = lastScrollPosition;

    var doc = document.documentElement;
    var newScrollPosition = (window.pageYOffset || doc.scrollTop)  - (doc.clientTop || 0);

    var scrollDifferenceInPx = newScrollPosition - lastScrollPosition;
    scrollDifferenceInPx = Math.abs(scrollDifferenceInPx);

    lastScrollPosition = newScrollPosition;

    // E.g., scrolling 8 lines (~ a paragraph down) will mean an update of about 7-10 for the scanning detector.
    // This is a relatively minor portion of the scanning update in most cases, but
    // it allows us to set scanning while the user is scrolling quickly over the whole document.
    // Cap it at a maximum constant so that the scores don't go to extremes when scrolling over the entire document.
    if(scanningScore < 100) {
    var scanningDetectorChange = scrollDifferenceInPx / 30;
    this.changeDetectorScores(0, 0, scanningDetectorChange);
    }
    
    // When scrolls occur, we should assume the current fixation is broken and lock the detectors for a bit - currently 1/3 second of lockout.
    scrollLockout = Math.floor(REFRESH_RATE / 3);

    //console.log("Scroll event. Scanning detector change: " + scanningDetectorChange);
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
        <div>
          {this.getPage(this.state.page, this.state.currentMode)}
        </div>
      </div>
    );
  }

  getPage(pageName, currentMode) {
    // We make the onClick callback functions in these functions, rather than in the Page classes, so that "this" refers to the App component.
    switch(pageName) {
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
          return this.createTutorialManual();
          break;
      case "FirstPage":
          return this.createFirstPage();
          break;
      case "SecondPage":
          return this.createSecondPage(currentMode);
          break;
      case "ThirdPage":
          return this.createThirdPage();
          break;
      case "FourthPage":
          return this.createFourthPage();
          break;
      default:
          return this.createTutorialSkimming();
    };
  }

  createTutorialSkimming() {

    // Once the user clicks Next to go to the skimming example, we need to know we should start keeping track of forward saccades for calibration.
    let startExampleFunc = () => {
      this.setState({page: "SkimmingExample"});
      isTakingTutorialFast = true;
    };

    return (<TutorialSkimming 
      onClick = {startExampleFunc}
    />);
  }

  createSkimmingExample() {
    
    // After the user clicks Next and leaves the skimming example, we should stop tracking forward saccades until the next chance for calibration.
    let endExampleFunc = () => {
      this.setState({page: "TutorialScanning"});
      isTakingTutorialFast = false;
    };

    return (<SkimmingExample 
      onClick = {endExampleFunc}
    />);
  }

  createTutorialScanning() {
    let startExampleFunc = () => {
      this.setState({page: "ScanningExample"});
      isTakingTutorialFast = true;
    };

    return (<TutorialScanning 
      onClick = {startExampleFunc}
    />);
  }

  createScanningExample() {
    let endExampleFunc = () => {
      this.setState({page: "TutorialReading"});
      isTakingTutorialFast = false;
    };

    return (<ScanningExample 
      onClick = {endExampleFunc}
    />);
  }

  createTutorialReading() {
    let startExampleFunc = () => {
      this.setState({page: "ReadingExample"});
      isTakingTutorialSlow = true;
    };

    return (<TutorialReading 
      onClick = {startExampleFunc}
    />);
  }

  createReadingExample() {
    let endExampleFunc = () => {
      this.setState({page: "TutorialManual"});
      isTakingTutorialSlow = false;

      // At this point, we've received all our calibration data. Let's calculate the result of that calibration now.
      this.calculateForwardSaccadeLength();
    };

    return (<ReadingExample 
      onClick = {endExampleFunc}
    />);
  }

  createTutorialManual() {
    return (<TutorialManual 
      onClick = {() => this.setState({page: "FirstPage"})}
    />);
  }

  createFirstPage() {
    return (<FirstPage 
      onClick = {() => this.firstPageOnClick()}
    />);
  }

  firstPageOnClick() {
    inTask = true;
    
    // Always start the task in reading mode with a decent lead, so the user gets at least a couple seconds of unformatted text.
    this.setState({currentMode: READING});
    readingScore = 50;
    skimmingScore = 0;
    scanningScore = 0;


    const startTime = Date.now();
    endTime = startTime + TASK_TIMER_IN_MS; // endTime variable is used to show the timer. The actual page switch is determined by the setTimeout call.
    setTimeout(this.endTaskIfOngoing.bind(this), TASK_TIMER_IN_MS);
    this.setState({page: "SecondPage"});
  }

  endTaskIfOngoing() {
    console.log("5 minute timer has elapsed");
    if (inTask) {
      this.setState({page: "ThirdPage"});
      inTask = false;
    }
  }

  createSecondPage(currentMode) {
    return (<SecondPage
      onClick = {() => this.secondPageOnClick()}
      currentMode = {currentMode}
    />);
  }

  secondPageOnClick() {
    inTask = false;
    this.setState({page: "ThirdPage"});
  }

  createThirdPage() {
    return (<ThirdPage
      onClick = {() => this.setState({page:"FourthPage"})}
    />);
  }

  createFourthPage() {
    return (<FourthPage
      onClick = {() => this.setState({page:"FirstPage"})}
    />);
  }
}

export class TutorialSkimming extends Component {
  render() {
    return (

      <div className="App">
        <h2>Tutorial</h2>
        <div className='text'>
          <p className='text'>
            In today's study, you will read passages while searching for information. Only some of the information in these passages will be useful.
            The passages you will read are quite long, so it is recommended to skim the text quickly to find the information you need.
            To help you read and find information more quickly, we have built a computer system that will format the text in certain ways.
          </p>
          <p className='text'>
            The first format is highlighting content words, like verbs, nouns, or adjectives. This has been scientifically shown to help with skimming
            a piece of text quickly. When you are ready, click "Next" to read a piece of text formatted in this way. There isn't any time limit and
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
            The second format is highlighting certain sentences. These sentences have been chosen by an automated tool because they are useful for
            understanding an overall summary of the passage. It's important to note that these sentences are not necessarily more important than sentences that are
            not highlighted. Sometimes important information may
            be in sentences that are not highlighted. Highlighted sentences are best used to scan quickly over a document and get a general idea of its contents. 
          </p>
          <p className='text'>
            When you are ready, click "Next" to read a piece of text formatted in this way. There isn't any time limit and
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

  // If this code is ever used for a user-facing application, we need to sanitize inputs for dangerouslySetInnerHTML().
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
            text thoroughly, like in situations where you want to make sure you understand all of the information in a passage.
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

  // If this code is ever used for a user-facing application, we need to sanitize inputs for dangerouslySetInnerHTML().
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


    // TODO: set this text dynamically.



    return (

      <div className="App">
        <h2>Tutorial</h2>

        <div className="sidebar-buttons">
          <button className='button flex-button' onClick={this.props.onClick} >
            Remove Formatting
          </button>
          <button className='button flex-button' onClick={this.props.onClick} >
            Highlight Content Words
          </button>
          <button className='button flex-button' onClick={this.props.onClick} >
            Highlight Sentences
          </button>
        </div>
        <div className='text'>
          <p className='text'>
            During one of your tasks, you will have control over the formatting of the text. In that task, a control bar will appear on the left-hand side
            of the screen. You can click the buttons on this control to change the highlighting of the text. If you prefer, you can also use the shortcuts
            Ctrl+1, Ctrl+2, and Ctrl+3 to change the formatting mode.
            
          </p>
          <p className='text'>
            Please try formatting this text now. When you're ready to continue, click "Next" to receive instructions about the first task.
          </p>

        </div>
        <button className='button' onClick={this.props.onClick} >
          Next
        </button>
      </div>
    );
  }
}




export class FirstPage extends Component {

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

export class SecondPage extends Component {

  // If this code is ever used for a user-facing application, we need to sanitize inputs for dangerouslySetInnerHTML().
  render() {

    var htmlText = "";

    if (this.props.currentMode == READING) {
      htmlText = testText;
    }
    else if (this.props.currentMode == SKIMMING) {
      htmlText = testTextEdited;
    }
    else {
      htmlText = testTextSentences;
    }

    return (
      <div className="App">
        <div className="sidebar">
          <Timer />
        </div>
        <h2>Ancient Egypt</h2>
        <p className='text' dangerouslySetInnerHTML={{__html: htmlText}}></p>
        <button className='button' onClick={this.props.onClick} >
          Move to Questions
        </button>
      </div>
    );
  }
}

export class ThirdPage extends Component {

  // TODO: we REALLY need to do this in a programmatic way. Fix this once we're done with the demo.
  render() {
    return (
      <div className="App">
        1.  What categorized the Egyptian climate in Predynastic and Early Dynastic times?
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

export class FourthPage extends Component {

  render() {
    return (
      <div className="App">
        <p className='text'> Thank you for answering! This concludes the demo.</p>
        <button className='button' onClick={this.props.onClick} >
          Back to Start
        </button>
      </div>
    );
  }
}

export function Timer() {

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
          <p> Current task: Find info about <b>weather and climate</b>.</p>
        </div>
      </div>
    </div>
  );
}