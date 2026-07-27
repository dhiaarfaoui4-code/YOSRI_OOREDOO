import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

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

  // API Route: Gemini Vision Product Recognition
  app.post("/api/recognize-product", async (req, res) => {
    try {
      const { imageData, inventory } = req.body;

      if (!imageData || !inventory || !Array.isArray(inventory)) {
        return res.status(400).json({
          success: false,
          error: "Missing required parameters: imageData or inventory"
        });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({
          success: false,
          error: "GEMINI_API_KEY is not configured on the server."
        });
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      // Clean base64 image data and detect mime type
      let base64Data = imageData;
      let mimeType = "image/jpeg";

      if (imageData.startsWith("data:")) {
        const matches = imageData.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
        if (matches) {
          mimeType = matches[1];
          base64Data = matches[2];
        } else {
          base64Data = imageData.replace(/^data:image\/[a-zA-Z+]+;base64,/, "");
        }
      }

      // Format inventory list clearly for fast prompt evaluation
      const inventoryListText = inventory
        .slice(0, 300)
        .map((item: any) => {
          const cat = item.category ? ` | Cat: ${item.category}` : "";
          const bar = item.barcode ? ` | Barcode: ${item.barcode}` : "";
          return `ID: "${item.id}" | Name: "${item.name}"${cat}${bar}`;
        })
        .join("\n");

      const prompt = `You are a computer vision expert for a mobile phone and electronics retail shop.
Analyze the provided product image (packaging box, charger, cable, case, powerbank, earphone, battery, glass, or accessory).
Identify visible brand names (e.g. Samsung, Apple, Xiaomi, Hoco, Joyroom, Devia, Borofone, Anker), wattage (e.g. 20W, 25W, 65W), capacity, model numbers, or packaging design.

Compare against this store inventory list:
${inventoryListText}

Select the top 1 to 4 candidate products from the inventory list that best match the image.
Assign confidence (0 to 100) and a brief reason in Arabic (max 10 words explaining the match).
Return strictly the candidates array adhering to the schema.`;

      console.log(`Analyzing product image with Gemini Vision against ${inventory.length} inventory items...`);

      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: [
          {
            inlineData: {
              data: base64Data,
              mimeType: mimeType,
            },
          },
          prompt,
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              candidates: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    itemId: { type: Type.STRING },
                    confidence: { type: Type.NUMBER },
                    reason: { type: Type.STRING },
                  },
                  required: ["itemId", "confidence", "reason"],
                },
              },
            },
            required: ["candidates"],
          },
          temperature: 0.1,
          maxOutputTokens: 500,
        },
      });

      const responseText = (response.text || "{}").trim();
      let parsedJson: any = { candidates: [] };

      try {
        let cleaned = responseText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
        const firstBrace = cleaned.indexOf("{");
        const lastBrace = cleaned.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          cleaned = cleaned.substring(firstBrace, lastBrace + 1);
        }
        parsedJson = JSON.parse(cleaned);
      } catch (pErr) {
        console.error("JSON parse fallback error:", pErr, "Raw text:", responseText);
      }

      console.log(`Gemini Vision returned ${parsedJson.candidates?.length || 0} candidates.`);

      return res.json({
        success: true,
        candidates: parsedJson.candidates || []
      });
    } catch (err: any) {
      console.error("Error in /api/recognize-product:", err);
      return res.status(500).json({
        success: false,
        error: err.message || "Failed to recognize product using Gemini Vision"
      });
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
