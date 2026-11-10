window.EmailSettingsApi = {
  async getAutomation() {
    const res = await authFetch("/email/automation");
    if (!res || !res.ok) throw new Error(await readErrorMessage(res, "Failed to load email automation settings."));
    return res.json();
  },

  async saveAutomation(settings) {
    const res = await authFetch("/email/automation", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings),
    });
    if (!res || !res.ok) throw new Error(await readErrorMessage(res, "Failed to save email automation settings."));
    return res.json();
  },
  async getSettings() {
    const res = await authFetch("/email/settings");
    if (!res || !res.ok) {
      const message = await readErrorMessage(
        res,
        `Failed to load email settings (${res?.status ?? "no response"}).`,
      );
      throw new Error(message);
    }
    return await res.json();
  },

  async saveSettings(payload) {
    const res = await authFetch("/email/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res || !res.ok) {
      const message = await readErrorMessage(
        res,
        `Failed to save settings (${res?.status ?? "no response"}).`,
      );
      throw new Error(message);
    }

    return await res.json();
  },

  async getMediaOutlets() {
    const res = await authFetch("/email/media-outlets");
    if (!res || !res.ok) {
      const settings = await this.getSettings();
      return settings.mediaOutlets || settings.MediaOutlets || [];
    }
    return await res.json();
  },

  async saveMediaOutlets(payload) {
    const outlets = payload?.mediaOutlets || payload?.MediaOutlets || [];

    async function saveViaSettingsFallback() {
      const settings = await window.EmailSettingsApi.getSettings();
      const mergedPayload = {
        enabled: Boolean(settings.enabled),
        smtpHost: settings.smtpHost || "",
        smtpPort: Number(settings.smtpPort || 0),
        useSsl: Boolean(settings.useSsl),
        username: settings.username || null,
        password: null,
        fromAddress: settings.fromAddress || "",
        fromName: settings.fromName || "TipIn",
        mediaOutlets: outlets,
        MediaOutlets: outlets,
      };

      const savedSettings = await window.EmailSettingsApi.saveSettings(mergedPayload);
      return savedSettings.mediaOutlets || savedSettings.MediaOutlets || outlets;
    }

    const res = await authFetch("/email/media-outlets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mediaOutlets: outlets,
        MediaOutlets: outlets,
      }),
    });

    if (!res || !res.ok) {
      try {
        return await saveViaSettingsFallback();
      } catch {
        const message = await readErrorMessage(
          res,
          `Failed to save media outlets (${res?.status ?? "no response"}).`,
        );
        throw new Error(message);
      }
    }

    return await res.json();
  },

  async sendTestEmail(payload) {
    const res = await authFetch("/email/settings/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res || !res.ok) {
      const message = await readErrorMessage(
        res,
        `Failed to send test email (${res?.status ?? "no response"}).`,
      );
      throw new Error(message);
    }

    return await res.json();
  },
};

async function readErrorMessage(res, fallback) {
  if (!res) return fallback;

  try {
    const payload = await res.clone().json();
    if (payload && typeof payload.error === "string" && payload.error.trim()) {
      return payload.error.trim();
    }
  } catch {
    // Ignore JSON parse errors and fall back to text.
  }

  try {
    const text = await res.text();
    if (text && text.trim()) return text.trim();
  } catch {
    // Ignore text read errors.
  }

  return fallback;
}
