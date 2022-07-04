

This file will be removed when I update the README to actually be about my project.
If the project is anywhere past the first couple weeks and you still see this file in git, please make fun of me.

-The Tobii server didn't work for me on fresh installs, with an error message about Tobii.EyeX.Client.dll being missing.
This was a giant red herring, and using a dependency analyzer I found the issue was actually that this computer didn't have the
visual C++ redistributable installed. (Note that you need to install BOTH the x86 and x64 versions if you're on a 64-bit machine.)
As far as I can tell I'm the only one that ever hit this issue because it's very difficult to actually not have the C++ redistributable
installed for you in the course of using a machine, but because this computer has barely ever been used it hadn't happened yet.