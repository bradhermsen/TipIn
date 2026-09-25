using System;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;
using System.Windows.Forms;
using Newtonsoft.Json.Linq;

namespace TipInBridgeApp
{
    public static class Program
    {
        [STAThread]
        public static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new TrayApplicationContext());
        }
    }

    public class AppSettings
    {
        public string GatewayIp { get; set; } = "192.168.68.66";
        public string AuthSecret { get; set; } = "TI-EMU-SECRET-2026";

        private static readonly string configPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "TipInGateway",
            "settings.json"
        );

        public static AppSettings Load()
        {
            try
            {
                if (File.Exists(configPath))
                {
                    string json = File.ReadAllText(configPath);
                    return Newtonsoft.Json.JsonConvert.DeserializeObject<AppSettings>(json) ?? new AppSettings();
                }
            }
            catch { }
            return new AppSettings();
        }

        public void Save()
        {
            try
            {
                string? dir = Path.GetDirectoryName(configPath);
                if (dir != null && !Directory.Exists(dir)) Directory.CreateDirectory(dir);
                string json = Newtonsoft.Json.JsonConvert.SerializeObject(this, Newtonsoft.Json.Formatting.Indented) ?? "{}";
                File.WriteAllText(configPath, json);
            }
            catch { }
        }
    }

    public class TrayApplicationContext : ApplicationContext
    {
        private readonly NotifyIcon trayIcon;
        private readonly ContextMenuStrip trayMenu;
        private readonly System.Windows.Forms.Timer backgroundPollTimer;
        private static readonly HttpClient client = new HttpClient() { Timeout = TimeSpan.FromSeconds(2) };

        private readonly AppSettings settings;
        private readonly string jsonOutputPath;
        private bool isConnected = false;

        public TrayApplicationContext()
        {
            settings = AppSettings.Load();

            string localDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "TipInGateway");
            if (!Directory.Exists(localDir)) Directory.CreateDirectory(localDir);
            jsonOutputPath = Path.Combine(localDir, "scoreboard.json");

            trayMenu = new ContextMenuStrip();
            trayMenu.Items.Add("Status: Connecting...", null, OnStatusClick);
            trayMenu.Items.Add(new ToolStripSeparator());
            trayMenu.Items.Add("Configure Settings (IP & Token)...", null, OnConfigureClick);
            trayMenu.Items.Add(new ToolStripSeparator());
            trayMenu.Items.Add("Exit", null, OnExit);

            trayIcon = new NotifyIcon()
            {
                Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath),
                ContextMenuStrip = trayMenu,
                Visible = true,
                Text = "TipIn Scoring Bridge"
            };

            backgroundPollTimer = new System.Windows.Forms.Timer();
            backgroundPollTimer.Interval = 100;
            backgroundPollTimer.Tick += async (sender, e) => await PollScoreboardState();
            backgroundPollTimer.Start();
        }

        private string GetBaseUrl() => $"http://{settings.GatewayIp}";

        private async Task PollScoreboardState()
        {
            try
            {
                string endpoint = "/api/state/clock";

                HttpRequestMessage request = new HttpRequestMessage(HttpMethod.Get, $"{GetBaseUrl()}{endpoint}");
                if (!string.IsNullOrEmpty(settings.AuthSecret))
                    request.Headers.Add("Authorization", $"Bearer {settings.AuthSecret}");

                HttpResponseMessage response = await client.SendAsync(request);
                if (!response.IsSuccessStatusCode)
                {
                    isConnected = false;
                    trayMenu.Items[0].Text = "Status: Disconnected";
                    trayIcon.Text = "TipIn: Disconnected";
                    return;
                }

                isConnected = true;
                string jsonResponse = await response.Content.ReadAsStringAsync();
                JObject raw = JObject.Parse(jsonResponse);

                int min = raw["clockMin"]?.Value<int>() ?? 0;
                int sec = raw["clockSec"]?.Value<int>() ?? 0;

                // Determine correct clock format
                string formattedClock;

                if (min > 0)
                {
                    // Standard hockey clock: M:SS
                    formattedClock = $"{min}:{sec:D2}";
                }
                else
                {
                    // Final minute: SS.T from lastMinuteClock
                    string lm = raw["lastMinuteClock"]?.Value<string>() ?? "0:00.0";

                    // Remove ALL leading zeros before the colon
                    // "00:33.2" → "33.2"
                    // "0:33.2" → "33.2"
                    // "000:33.2" → "33.2"
                    var parts = lm.Split(':');
                    string mm = parts[0];
                    string rest = parts[1];

                    mm = mm.TrimStart('0'); // remove all leading zeros

                    if (mm == "")
                        formattedClock = rest; // "33.2"
                    else
                        formattedClock = mm + ":" + rest;
                }

                // Helper to convert "0", "00:00" to null and remove leading zeros from mm:ss
                JToken NormalizePenalty(JToken? token)
                {
                    if (token == null)
                        return null;

                    if (token.Type == JTokenType.Integer && token.Value<int>() == 0)
                        return null;

                    if (token.Type == JTokenType.String)
                    {
                        string value = token.Value<string>() ?? "";

                        if (value == "00:00")
                            return null;

                        // Remove leading zero from mm:ss (e.g., "08:12" → "8:12")
                        if (value.Length == 5 && value[0] == '0')
                            return value.Substring(1);
                    }

                    return token;
                }

                JObject trimmed = new JObject
                {
                    ["clockFormatted"] = formattedClock,
                    ["clockRunning"] = raw["clockRunning"],
                    ["clockMin"] = min,
                    ["clockSec"] = sec,
                    ["clockTenths"] = raw["clockTenths"],
                    ["homeScore"] = raw["homeScore"],
                    ["awayScore"] = raw["awayScore"],
                    ["homeShots"] = raw["homeShots"],
                    ["awayShots"] = raw["awayShots"],
                    ["period"] = raw["period"],

                    // Penalties — now null when 0 or "00:00" and leading zeros removed
                    ["homePen1Player"] = NormalizePenalty(raw["homePen1Player"]),
                    ["homePen1Time"] = NormalizePenalty(raw["homePen1Time"]),
                    ["homePen2Player"] = NormalizePenalty(raw["homePen2Player"]),
                    ["homePen2Time"] = NormalizePenalty(raw["homePen2Time"]),
                    ["awayPen1Player"] = NormalizePenalty(raw["awayPen1Player"]),
                    ["awayPen1Time"] = NormalizePenalty(raw["awayPen1Time"]),
                    ["awayPen2Player"] = NormalizePenalty(raw["awayPen2Player"]),
                    ["awayPen2Time"] = NormalizePenalty(raw["awayPen2Time"]),

                    ["home"] = raw["home"],
                    ["away"] = raw["away"],
                    ["running"] = raw["running"],
                    ["shotsHome"] = raw["shotsHome"],
                    ["shotsAway"] = raw["shotsAway"]
                };

                jsonResponse = trimmed.ToString();

                // Write vMix JSON
                string vmixJsonFormat = "[" + jsonResponse + "]";
                File.WriteAllText(jsonOutputPath, vmixJsonFormat);

                trayIcon.Text = $"TipIn Clock: {formattedClock}";
                trayMenu.Items[0].Text = $"Status: Connected ({settings.GatewayIp})";
            }
            catch
            {
                isConnected = false;
                trayMenu.Items[0].Text = "Status: Disconnected";
                trayIcon.Text = "TipIn: Disconnected";
            }
        }

        private void OnConfigureClick(object? sender, EventArgs e)
        {
            using (var prompt = new Form())
            {
                prompt.Width = 340;
                prompt.Height = 220;
                prompt.FormBorderStyle = FormBorderStyle.FixedDialog;
                prompt.Text = "TipIn Scoring Bridge Configuration";
                prompt.StartPosition = FormStartPosition.CenterScreen;
                prompt.MaximizeBox = false;
                prompt.MinimizeBox = false;

                var lblIp = new Label() { Left = 20, Top = 15, Text = "Gateway IP Address:", Width = 280 };
                var txtIp = new TextBox() { Left = 20, Top = 35, Width = 280, Text = settings.GatewayIp };

                var lblToken = new Label() { Left = 20, Top = 70, Text = "Security / Auth Token:", Width = 280 };
                var txtToken = new TextBox() { Left = 20, Top = 90, Width = 280, Text = settings.AuthSecret };

                var btnSave = new Button() { Text = "Save", Left = 220, Width = 80, Top = 135, DialogResult = DialogResult.OK };
                btnSave.Click += (s, ev) => { prompt.Close(); };

                prompt.Controls.Add(lblIp);
                prompt.Controls.Add(txtIp);
                prompt.Controls.Add(lblToken);
                prompt.Controls.Add(txtToken);
                prompt.Controls.Add(btnSave);
                prompt.AcceptButton = btnSave;

                if (prompt.ShowDialog() == DialogResult.OK)
                {
                    settings.GatewayIp = txtIp.Text.Trim();
                    settings.AuthSecret = txtToken.Text.Trim();
                    settings.Save();
                    MessageBox.Show("Configuration updated successfully.", "Saved", MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
            }
        }

        private void OnStatusClick(object? sender, EventArgs e)
        {
            string vmixUrl = $"file:///{jsonOutputPath.Replace("\\", "/")}";

            MessageBox.Show(
                $"Gateway: {settings.GatewayIp}\nMode: Clock Only\nConnected: {isConnected}\n\nvMix JSON File:\n{vmixUrl}",
                "TipIn Scoring Bridge Status",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information
            );
        }

        private void OnExit(object? sender, EventArgs e)
        {
            backgroundPollTimer?.Stop();
            trayIcon.Visible = false;
            Application.Exit();
        }
    }
}
