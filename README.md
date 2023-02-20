## Impulse Reading

Impulse Reading is an experiment in making text responsive to the user's gaze. It displays a text search task to the user, and formats that text according to whether the user is reading, skimming, or scanning.
Impulse Reading should be used with a Tobii 5. Other Tobii EyeX compatible devices will mostly work, but the code assumes a 33hz refresh rate that will differ for other eye trackers.

### Install
If needed, begin by installing Yarn. (https://classic.yarnpkg.com/lang/en/docs/install/#windows-stable)
Once done, install dependencies using Yarn by executing the following in a command line in this directory:

```
yarn
```

### Usage
Begin by:
1. Calibrating your Tobii 5
2. Running the eye tracker server, then
3. Launching the app.

#### Calibrate the Tobii 5
In the Tobii Experience app which should already be installed on your computer, calibrate your eye tracker using the "Improve calibration" button, or set up a new profile.

#### Run the eye tracker server
Run 'Tobii Server/TobiiServer.exe' - that is, the TobiiServer.exe file from the folder "Tobii Server" in this directory. You should keep this window open while using the app. I recommend minimizing the window while using the app to keep the text scrolling from being distracting.

This step commonly experiences issues on new computers. See "Eye tracker server issues" below.

#### Launch the app
In a command line, execute:
```
yarn start
```

After launching, follow the commands onscreen.


### Troubleshooting

#### Calibrate the Tobii 5 issues
You need to install Tobii Experience to use the eyetracker. Usually this should happen automatically but sometimes it doesn't.
I followed these directions and it worked fine: https://help.tobii.com/hc/en-us/articles/360009929118-Get-the-Tobii-Experience-app

#### Eye tracker server issues
If the TobiiServer.exe file gives you an error about Tobii.EyeX.Client.dll being missing, the issue might be with your Visual C++ redistributable. Install the latest versions of BOTH x86 and x64, then try again. This should only have to be done once, and probably shouldn't happen unless you're on a new computer.