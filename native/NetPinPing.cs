// Small managed helper: .NET Framework is supplied by supported Windows 10 systems.
// Compiled at build time; no PowerShell execution policy change on user machines.
using System;
using System.Globalization;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text.RegularExpressions;
public static class NetPinPing {
    public static int Main(string[] args) {
        IPAddress address;
        if (args.Length != 1 || !Regex.IsMatch(args[0], @"^(0|[1-9]\d{0,2})(\.(0|[1-9]\d{0,2})){3}$") ||
            !IPAddress.TryParse(args[0], out address) || address.AddressFamily != AddressFamily.InterNetwork) {
            Console.Error.WriteLine("Invalid IPv4 address"); return 2;
        }
        try {
            using (Ping ping = new Ping()) {
                PingReply reply = ping.Send(address, 1000);
                Console.WriteLine("{\"status\":\"" + reply.Status.ToString() + "\",\"rtt\":" + reply.RoundtripTime.ToString(CultureInfo.InvariantCulture) + "}");
            }
        } catch { Console.WriteLine("{\"status\":\"Error\",\"rtt\":null}"); }
        return 0;
    }
}
