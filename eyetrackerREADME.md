## Tobii Electron, React and Webpack boilerplate
<p align="center">
  <img src="/docs/images/box.png?raw=true" width="135" align="center">
  <br>
  <br>
</p>

This boilerplate code includes a simple demo to help get you up and running with your next eye-tracking based electron application. The included demo is a simple collision detection example created to mimic a mouse ```onHover``` event handler for any given HTML element. Code for this example can be found in the ```src\components\App.js``` file.

<p align="center">
  <img src="/docs/images/demo.gif?raw=true" width="600" align="center">
  <br>
  <br>
</p>

### Table of contents

* [Supported Devices](#supported-devices)
* [Install](#install)
* [Usage](#usage)
* [Change app title](#change-app-title)
* [Built With](#built-with)

### Supported Devices
This project builds electron apps for the Windows platform exclusively. This is because the Tobii Electron Streaming backend uses Tobii's EyeX SDK which is only supported on Windows. 

#### Supported Eye Trackers
The Tobii Electron Streaming backend supports all Tobii EyeX compatible devices.


Tested devices include:
* Tobii 4C 
* Tobii 5

### Install

#### Clone this repo

```
git clone https://github.com/vialab/Tobii-Electron-Starter.git
```

#### Install dependencies

```
yarn
```

### Usage

#### Run the Front-End

```
yarn start
```

#### Run the Back-End
```
Run 'Tobii Server/TobiiServer.exe' 
```

The back-end streams eye-gaze data from Tobii's C# SDK as a UDP packet on localhost:33333 the Node/Electron client application.These packets are processed in ```main.js``` and passed to the front-end using the IPCRenderer.

**Incoming messages are sent as JSON objects depending on one of two cases:**


No gaze detected:


&ensp;```{"id":"gaze_data", "attention":false,"x":0, "y": 0, "timestamp":0}```


Gaze Detected:


&ensp;``` {"id":"gaze_data", "attention":true,"x":1532.91166365034, "y": 263.716703100034, "timestamp":183474646.6594}```

#### Build the app (automatic)

```
yarn package
```

#### Build the app (manual)

```
yarn build
```

### Change app title

This boilerplate uses [HTML Webpack Plugin](https://github.com/jantimon/html-webpack-plugin#options) to generate the HTML file of the app. Changing app title is possible only through webpack configs, `webpack.build.config.js` and `webpack.dev.config.js`. App title can be changed by adding objects of options.

In `webpack.build.config.js`:

```JavaScript
plugins: [
  new HtmlWebpackPlugin({title: 'New app title '}),// Add this (line 41)
  new MiniCssExtractPlugin({
    // Options similar to the same options in webpackOptions.output
    // both options are optional
    filename: 'bundle.css',
    chunkFilename: '[id].css'
  }),
  new webpack.DefinePlugin({
    'process.env.NODE_ENV': JSON.stringify('production')
  }),
  new BabiliPlugin()
],
```

In `webpack.dev.config.js`:

```JavaScript
plugins: [
  new HtmlWebpackPlugin({title: 'New app title '}),// Add this (line 36)
  new webpack.DefinePlugin({
    'process.env.NODE_ENV': JSON.stringify('development')
  })
],
```

### Built With
This boilerplate code builds upon code from:

* [Tobii Electron Streaming](https://github.com/frocker/tobii-electron-streaming)
* The [Minimal Electron, React and Webpack boilerplate project](https://github.com/alexdevero/electron-react-webpack-boilerplate) - MIT © [Alex Devero](https://alexdevero.com).

