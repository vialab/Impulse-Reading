using System;
using System.Diagnostics;
using System.Net.Sockets;
using System.Text;
using Tobii.Interaction;
using Tobii.Interaction.Framework;
using Tobii.Interaction.Model;

/*Integrate this into a C# project that is set up to use the Tobii SDK.
  It will send the Tobii input to your electron App over UDP.
*/
namespace TobiiSDKServer
{
    class TobiiServer
    {
        static void Main(string[] args)
        {

            // Initialise Host to Tobii Connection
            var host = new Host();

            //Uncomment this section to Launch Calibration when the project opens
            /*
             System.Threading.Thread.Sleep(1000);
             host.Context.LaunchConfigurationTool(ConfigurationTool.RetailCalibration, (data) => { });
             System.Threading.Thread.Sleep(10000);
            */

            //Setup Server
            UdpClient udpClient = new UdpClient();
            udpClient.Connect("127.0.0.1", 33333);

            //Create stream. 
            var gazePointDataStream = host.Streams.CreateGazePointDataStream();

            // Create interactor
            // InteractorAgents are defined per window, so we need a handle to it.
            //var currentWindowHandle = Process.GetCurrentProcess().MainWindowHandle;
            var currentWindowHandle = Process.GetProcesses().ToString();
            Console.WriteLine(currentWindowHandle);

            /*
            // Let's also obtain its bounds using Windows API calls (hidden in a helper method below).
            var currentWindowBounds = GetWindowBounds(currentWindowHandle);
            // Let's create the InteractorAgent.
            var interactorAgent = host.InitializeVirtualInteractorAgent(currentWindowHandle, "ConsoleWindowAgent");

            // Next we are going to create an interactor, which we will define with the gaze aware behavior.
            // Gaze aware behavior simply tells you whether somebody is looking at the interactor or not.
            interactorAgent
                .AddInteractorFor(currentWindowBounds)
                .WithGazeAware()
                .HasGaze(() => Console.WriteLine("Hey there!"))
                .LostGaze(() => Console.WriteLine("Bye..."));
            */
            // Get the gaze data
            gazePointDataStream.GazePoint((x, y, ts) => SendInput(udpClient, x, y, ts));

            // Read
            Console.ReadKey();

            // we will close the coonection to the Tobii Engine before exit.
            host.DisableConnection();

            //ToDo: Add code to boot your Electron App here

        }

        static void SendInput(UdpClient client, double x, double y, double ts)
        {
            String sendString = @"{""id"":""gaze_data"", ""x"":" + x + @", ""y"": " + y + @", ""timestamp"":" + ts + @"}";
            Console.WriteLine(sendString);
            Byte[] senddata = Encoding.ASCII.GetBytes(sendString);
            client.Send(senddata, senddata.Length);
        }
    }
}
