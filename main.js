'use strict'

// Import parts of electron to use
const { app, BrowserWindow, dialog } = require('electron')
const path = require('path')
const url = require('url')

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow

// Keep a reference for dev mode
let dev = false

// Broken:
// if (process.defaultApp || /[\\/]electron-prebuilt[\\/]/.test(process.execPath) || /[\\/]electron[\\/]/.test(process.execPath)) {
//   dev = true
// }

if (process.env.NODE_ENV !== undefined && process.env.NODE_ENV === 'development') {
  dev = true
}

// Temporary fix broken high-dpi scale factor on Windows (125% scaling)
// info: https://github.com/electron/electron/issues/9691
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('high-dpi-support', 'true')
  app.commandLine.appendSwitch('force-device-scale-factor', '1')
}

function createWindow() {
  // Create the browser window.
  // Width/height are ignored for fullscreen, but are set to make switching between fullscreen a one-line change.
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    fullscreen: true,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })

  // and load the index.html of the app.
  let indexPath

  if (dev && process.argv.indexOf('--noDevServer') === -1) {
    indexPath = url.format({
      protocol: 'http:',
      host: 'localhost:8080',
      pathname: 'index.html',
      slashes: true
    })
  } else {
    indexPath = url.format({
      protocol: 'file:',
      pathname: path.join(__dirname, 'dist', 'index.html'),
      slashes: true
    })
  }

  mainWindow.loadURL(indexPath)

  mainWindow.confirm = (message) => {
    const electron = window.require('electron')
    const { dialog } = electron.remote
    const buttonIdx = dialog.showMessageBoxSync(null, {
      type: 'question',
      message,
      buttons: ['OK', 'Cancel'],
      cancelId: 1,
      defaultId: 0,
    })
    return buttonIdx === 0
  }

  // Don't show until we are ready and loaded
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()

    // Open the DevTools automatically if developing
    if (false) {
      const { default: installExtension, REACT_DEVELOPER_TOOLS } = require('electron-devtools-installer')

      installExtension(REACT_DEVELOPER_TOOLS)
        .catch(err => console.log('Error loading React DevTools: ', err))
      mainWindow.webContents.openDevTools()
    }
  })

  // Emitted when the window is closed.
  mainWindow.on('closed', function() {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null
  })
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow)

// Quit when all windows are closed.
app.on('window-all-closed', () => {
  // On macOS it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  // On macOS it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (mainWindow === null) {
    createWindow()
  }
})

// Tobii Eye Tracker Integration
const PORT = 33333;
const HOST = '127.0.0.1';
const dgram = require('dgram');
const server = dgram.createSocket('udp4');

server.on('listening', function () {
    var address = server.address();
    console.log('UDP Server listening on ' + address.address + ":" + address.port);
});

server.on('message', function (message, remote) {
    try {
      parseMessage(message);
    }
    catch(error) {
      console.log("Error:", error);
    }
});

function parseMessage(message){
  /**
   * Parses UDP message from TobiiServer.exe and sends it to the front-end
   * Incoming messages are one of two types:
   *    No gaze detected:
   *      Sample message: {"id":"gaze_data", "attention":false,"x":0, "y": 0, "timestamp":0}
   *    Gaze Detected:
   *      Sample message: {"id":"gaze_data", "attention":true,"x":1532.91166365034, "y": 263.716703100034, "timestamp":183474646.6594}
   */

  var messageObj = JSON.parse(message);

  if(mainWindow !== undefined){
    mainWindow.webContents.send('gaze-pos', messageObj);
  }

  //console.log("Parse message: ", messageObj)
}

server.bind(PORT, HOST);
