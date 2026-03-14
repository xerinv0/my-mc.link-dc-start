import {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import MyMCLib from "mymc-lib";

// 1. Setup your Discord Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const MyMC = new MyMCLib(process.env.MYMC_API);
/**
 * Helper to format the IP object into a string
 * Expects: { hostname: "...", port: 1234 }
 */
const formatAddress = (ipObj) => {
  if (ipObj && ipObj.success && ipObj.hostname) {
    return `${ipObj.hostname}:${ipObj.port}`;
  }
  return null;
};

const generateEmbed = (data, isOnline, ips = {}, isRetrying = false) => {
  const statusEmoji = isOnline
    ? "🟢 ONLINE"
    : isRetrying
      ? "⏳ STARTING..."
      : "🔴 OFFLINE";
  const color = isOnline ? 0x2ecc71 : isRetrying ? 0xf1c40f : 0xe74c3c;

  const embed = new EmbedBuilder()
    .setTitle("🖥️ Server Dashboard")
    .setColor(color)
    .addFields(
      {
        name: "📊 Resources",
        value: `\`\`\`json\nCPU: ${data?.stats?.cpu || "0%"}\nRAM: ${data?.stats?.memory?.percent || "0%"}\n\`\`\``,
        inline: true,
      },
      {
        name: "🔌 Status",
        value: `**State:** \`${statusEmoji}\`\n**Last Update:** <t:${Math.floor(Date.now() / 1000)}:R>`,
        inline: true,
      },
    )
    .setTimestamp();

  if (isOnline || isRetrying) {
    const javaDisplay = ips.javaIp ? `\`${ips.javaIp}\`` : "_Fetching..._";
    const bedrockDisplay = ips.geyserIp
      ? `\`${ips.geyserIp}\``
      : "_Fetching..._";

    embed.addFields({
      name: "🔗 Connection Addresses",
      value: `**Java Edition:** ${javaDisplay} | \`tororu.my-mc.link\`\n**Bedrock Edition:** ${bedrockDisplay}`,
      inline: false,
    });
  }

  return embed;
};

client.on("messageCreate", async (message) => {
  if (message.content === "!monitor") {
    let state = {
      isOnline: false,
      isRetrying: false,
      ips: { javaIp: null, geyserIp: null },
      currentData: await MyMC.getStats(),
    };

    // Auto-detect online status on command start
    state.isOnline = state.currentData?.stats?.memory?.percent !== "0.00%";

    const getRow = () => {
      const startBtn = new ButtonBuilder()
        .setCustomId("start_action")
        .setLabel(
          state.isRetrying
            ? "Booting..."
            : state.isOnline
              ? "Server Online"
              : "Start Server",
        )
        .setStyle(state.isOnline ? ButtonStyle.Success : ButtonStyle.Primary)
        .setDisabled(state.isOnline || state.isRetrying);

      return new ActionRowBuilder().addComponents(startBtn);
    };

    const monitorMessage = await message.channel.send({
      embeds: [generateEmbed(state.currentData, state.isOnline)],
      components: [getRow()],
    });

    // --- ENHANCED RETRY LOGIC ---
    const fetchIpsWithRetry = async (retries = 5) => {
      for (let i = 0; i < retries; i++) {
        try {
          const rawJava = await MyMC.createMyLink();
          const rawGeyser = await MyMC.createMyGeyserLink();

          const formattedJava = formatAddress(rawJava);
          const formattedGeyser = formatAddress(rawGeyser);

          if (formattedJava && formattedGeyser) {
            state.ips = { javaIp: formattedJava, geyserIp: formattedGeyser };
            return true;
          }
        } catch (e) {
          console.log("IPs not ready yet, retrying...");
        }
        await new Promise((res) => setTimeout(res, 5000)); // Wait 5s between retries
      }
      return false;
    };

    // --- LIVE REFRESH ---
    const refreshInterval = setInterval(async () => {
      try {
        state.currentData = await MyMC.getStats();
        const currentlyRunning =
          state.currentData?.stats?.memory?.percent !== "0.00%";

        // If the server was online but now it's offline (crashed/stopped)
        if (state.isOnline && !currentlyRunning) {
          state.isOnline = false;
          state.ips = { javaIp: null, geyserIp: null };
        }
        // If it was offline but is now online (started manually elsewhere)
        else if (!state.isOnline && currentlyRunning && !state.isRetrying) {
          state.isOnline = true;
          fetchIpsWithRetry(2); // Quick attempt to grab IPs
        }

        await monitorMessage
          .edit({
            embeds: [
              generateEmbed(
                state.currentData,
                state.isOnline,
                state.ips,
                state.isRetrying,
              ),
            ],
            components: [getRow()],
          })
          .catch(() => clearInterval(refreshInterval));
      } catch (err) {
        console.error("Refresh Error:", err);
      }
    }, 10000);

    // --- INTERACTION HANDLING ---
    const collector = monitorMessage.createMessageComponentCollector({
      time: 3600000,
    });

    collector.on("collect", async (interaction) => {
      if (interaction.customId === "start_action") {
        state.isRetrying = true;

        await interaction.update({
          embeds: [generateEmbed(state.currentData, false, {}, true)],
          components: [getRow()],
        });

        const startResult = await MyMC.startServer();

        if (startResult?.success) {
          await fetchIpsWithRetry(); // This will loop until IPs are found
          state.isOnline = true;
        }

        state.isRetrying = false;
        await monitorMessage.edit({
          embeds: [
            generateEmbed(state.currentData, state.isOnline, state.ips, false),
          ],
          components: [getRow()],
        });
      }
    });

    collector.on("end", () => clearInterval(refreshInterval));
  }
});

client.login(process.env.DISCORD_TOKEN);
