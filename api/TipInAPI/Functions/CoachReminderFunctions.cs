using System;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using TipInAPI.Services;

namespace TipInAPI.Functions
{
    public class CoachReminderFunctions
    {
        private readonly CoachReminderService _service;
        public CoachReminderFunctions(CoachReminderService service) { _service = service; }

        [Function("SendCoachReminders")]
        public Task Run([TimerTrigger("0 */15 * * * *", UseMonitor = true)] TimerInfo timer) =>
            _service.RunAsync(DateTime.UtcNow);
    }
}
