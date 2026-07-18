import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Enable JSON request body parsing with size limits for PDF reports
  app.use(express.json({ limit: "20mb" }));

  // API Route: Send Telegram PDF Document
  app.post("/api/send-telegram-pdf", async (req, res) => {
    try {
      const { botToken: rawBotToken, chatId: rawChatId, pdfBase64, filename = "report.pdf", caption } = req.body;

      if (!rawBotToken || !rawChatId || !pdfBase64) {
        return res.status(400).json({ error: "Missing required parameters: botToken, chatId, or pdfBase64" });
      }

      const botToken = String(rawBotToken).replace(/\s+/g, "");
      const chatId = String(rawChatId).replace(/\s+/g, "");

      const base64Data = pdfBase64.replace(/^data:application\/pdf;base64,/, "");
      const buffer = Buffer.from(base64Data, "base64");
      const blob = new Blob([buffer], { type: "application/pdf" });

      const formData = new FormData();
      formData.append("chat_id", chatId);
      formData.append("document", blob, filename);
      if (caption) {
        formData.append("caption", caption);
      }

      console.log(`Sending Telegram document ${filename} to chat ${chatId}...`);

      const telegramUrl = `https://api.telegram.org/bot${botToken}/sendDocument`;
      const response = await fetch(telegramUrl, {
        method: "POST",
        body: formData,
      });

      const responseData = await response.json();

      if (!response.ok) {
        console.error("Telegram API sendDocument returned error:", responseData);
        return res.status(response.status).json({
          success: false,
          error: responseData.description || "Telegram API failed to send document",
        });
      }

      return res.json({ success: true, data: responseData });
    } catch (error: any) {
      console.error("Error in send-telegram-pdf API:", error);
      return res.status(500).json({ success: false, error: error.message || "Internal server error" });
    }
  });

  // API Route: Send Telegram Notification
  app.post("/api/send-telegram", async (req, res) => {
    try {
      const { botToken: rawBotToken, chatId: rawChatId, message, parseMode = "HTML" } = req.body;

      if (!rawBotToken || !rawChatId || !message) {
        return res.status(400).json({ error: "Missing required parameters: botToken, chatId, or message" });
      }

      const botToken = String(rawBotToken).replace(/\s+/g, "");
      const chatId = String(rawChatId).replace(/\s+/g, "");

      console.log(`Sending Telegram notification to chat ${chatId} using mode ${parseMode}...`);

      const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const response = await fetch(telegramUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: parseMode,
        }),
      });

      const responseData = await response.json();

      if (!response.ok) {
        console.error("Telegram API returned error:", responseData);
        return res.status(response.status).json({
          error: responseData.description || "Failed to send Telegram message",
          details: responseData,
        });
      }

      console.log("Telegram notification sent successfully.");
      return res.json({ success: true, data: responseData });
    } catch (err: any) {
      console.error("Error in /api/send-telegram:", err);
      return res.status(500).json({ error: "Internal server error", message: err.message });
    }
  });

  // API Route: Send WhatsApp (CallMeBot) Notification
  app.post("/api/send-whatsapp", async (req, res) => {
    try {
      const { phone: rawPhone, apiKey: rawApiKey, message } = req.body;

      if (!rawPhone || !rawApiKey || !message) {
        return res.status(400).json({ error: "Missing required parameters: phone, apiKey, or message" });
      }

      const phone = String(rawPhone).replace(/\s+/g, "");
      const apiKey = String(rawApiKey).replace(/\s+/g, "");

      console.log(`Sending WhatsApp notification to phone ${phone}...`);

      const cleanPhone = phone.replace("+", "");
      // CallMeBot uses a GET request
      const whatsappUrl = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(
        cleanPhone
      )}&text=${encodeURIComponent(message)}&apikey=${encodeURIComponent(apiKey)}`;

      const response = await fetch(whatsappUrl);
      const textResponse = await response.text();

      // CallMeBot usually returns plain text or HTML
      if (!response.ok) {
        console.error("CallMeBot API returned error:", textResponse);
        return res.status(response.status).json({
          error: "Failed to send WhatsApp message via CallMeBot",
          details: textResponse,
        });
      }

      console.log("WhatsApp notification sent successfully. Response:", textResponse);
      return res.json({ success: true, details: textResponse });
    } catch (err: any) {
      console.error("Error in /api/send-whatsapp:", err);
      return res.status(500).json({ error: "Internal server error", message: err.message });
    }
  });

  // API health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development vs static files serving for production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
