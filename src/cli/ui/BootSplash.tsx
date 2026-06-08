import { Box, Text } from "ink";
// biome-ignore lint/style/useImportType: tsconfig jsx=react needs React in value scope for JSX compilation
import React, { useEffect, useState } from "react";
import { t } from "../../i18n/index.js";
import { FG, TONE } from "./theme/tokens.js";

const RISING_LOGO = [
  "██████╗ ██╗███████╗██╗███╗   ██╗ ██████╗",
  "██╔══██╗██║██╔════╝██║████╗  ██║██╔════╝",
  "██████╔╝██║███████╗██║██╔██╗ ██║██║  ███╗",
  "██╔══██╗██║╚════██║██║██║╚██╗██║██║   ██║",
  "██║  ██║██║███████║██║██║ ╚████║╚██████╔╝",
  "╚═╝  ╚═╝╚═╝╚══════╝╚═╝╚═╝  ╚═══╝ ╚═════╝",
];

const SKULL_LINES = [
  "⠀⠀⠀⢀⡴⣫⠎⠙⣡⠞⣡⠖⢋⡥⠀⠀⠀⠀⠀⠀⠀⢀⣤⣾⣿⡟⣿⡿⠁⠀⠙⢿⣿⣿⣿⣿⣿⠙⢿⣿⣿⣿⣿⣿⣶⣄⡀⠀⠀⠀⠀⠀⠈⠓⠁⠀⢉⠲⣍⠳⣄⠀⠀⠀⠀⠀",
  "⠀⠀⢠⢮⣞⠕⣰⢫⠄⠈⠁⡴⠋⠰⠂⠀⠀⠀⠀⢀⣴⣿⣿⣿⡟⠀⣿⡃⠀⠀⠀⠈⣻⣿⣿⣿⣿⣇⣀⠻⣿⣿⣿⣿⣿⣿⣿⣦⡀⠀⠀⠀⠀⠀⢀⣀⡫⡕⢌⠣⡈⢣⡀⠀⠀⠀",
  "⠀⢀⢾⣿⠏⡼⣵⠋⣠⠀⠀⠀⠀⠀⠀⠀⠀⠀⣰⣿⣿⣿⣿⣿⠴⢺⡏⠀⠀⠀⠀⠀⠈⠻⣿⣿⣿⡇⠀⠉⠛⣿⣿⠹⣿⣿⣿⣿⣿⣦⠀⠀⠀⠀⠈⠳⣝⢎⢮⢳⡙⢄⢱⣄⠀⠀",
  "⠀⣞⣜⡏⣼⣽⠃⡼⢃⡴⠂⠀⠀⠀⠀⠀⢀⣼⣿⣿⣿⣿⣿⠋⠀⠘⠃⠀⠀⠀⠀⠀⠀⠀⠘⣿⣿⡇⠀⠀⠀⢘⣿⠷⣽⣿⣿⣿⣿⣿⣷⡄⠀⠀⠀⠀⠈⠈⠀⢀⠀⣈⢦⠽⡆⠀",
  "⢼⢱⡍⠀⠃⠃⠸⢡⡟⠀⢠⡞⠀⠀⢀⣴⣿⣿⣿⣿⣿⣿⢇⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠘⣿⡇⣠⣤⣒⢍⣸⡀⠈⢿⣿⣿⣿⣿⣿⣿⣆⠀⠀⠀⢀⢰⡘⣎⢧⠘⡎⣧⠹⡄",
  "⢸⢠⠇⡞⢰⠀⡆⢠⠀⢀⠈⠤⠤⠶⠿⢟⣿⣿⣿⣿⣻⡿⠀⣈⠭⠶⣶⣤⣤⣀⠀⠀⠀⠀⠐⡶⠺⢫⡟⠁⣶⣶⡎⠙⢦⠘⣿⡏⣿⣿⣿⣿⣿⣧⡀⠀⠘⣆⢣⢸⠈⡆⢹⣹⡆⠇",
  "⢸⢸⠀⡇⢿⢰⡇⣸⢀⡏⠀⡀⢀⡀⠀⣼⣿⣿⣿⣿⠻⣧⠞⠁⣾⣿⠆⠹⡄⠀⠙⡆⠀⠀⠀⠓⠊⡟⠀⠀⠙⠛⠁⠀⠈⡇⢿⢷⢿⣿⣿⣿⣿⣟⠛⠂⠀⠘⠘⠈⠀⠁⠈⠃⡇⡀",
  "⢸⢸⡄⣇⢸⠸⡇⢻⠈⡇⢸⠇⠘⠀⢰⣿⣿⣿⣿⡏⠀⡇⠀⠀⠈⠁⠀⠀⡇⠀⢰⣣⠀⠀⠀⠀⠀⠸⣀⠀⠀⠀⠀⠀⢠⠃⠘⠈⢸⣿⣿⣿⣿⣿⡀⢀⡄⣶⠀⡆⠀⢰⠀⡇⡇⡇",
  "⠸⡿⡇⡙⠘⠃⠃⠈⠀⣁⠈⡅⠀⣦⣿⣿⣿⣿⣿⣧⠀⢧⠀⠀⠀⠀⢀⠔⡇⠀⠸⡍⠀⡀⠀⠀⠀⠀⣌⡑⡖⠒⢲⠚⣁⠄⠀⠀⢸⣿⢏⣽⣿⣿⣧⢸⢡⠇⢸⠃⢀⡎⣰⢡⣧⠇",
  "⠀⢹⣧⢹⡰⡄⣦⠀⣆⠸⡄⣹⣾⣿⣿⡿⣿⡿⣿⡟⠀⠀⠙⠒⠒⠋⠁⠀⠈⠒⠒⠃⠀⠈⠀⠀⠀⠀⠀⠸⠉⠉⠉⠏⠀⠀⠀⠀⣾⢣⡏⠸⣿⣿⣿⣧⣈⠀⠁⢀⠈⠀⣡⢫⠎⠀",
  "⢦⡀⢫⢧⢣⡹⣜⢧⠘⢦⠹⣄⠳⡀⢳⢀⣿⣷⡝⣷⠀⠀⠀⠀⠀⠀⢀⣀⣤⠤⠖⠒⠚⠋⠉⠉⠉⠉⠉⠐⠒⡆⠤⣄⣀⠀⠀⢸⡏⣸⣓⢧⣿⡇⡴⢃⣞⡞⢠⠞⡼⣱⣣⠏⠀⠀",
  "⠔⠛⠲⣽⣷⡳⡝⠎⠓⠀⠀⠀⠀⣄⠀⣼⣿⣿⣽⡞⡆⠀⠀⡠⡔⠊⠉⠀⠀⠀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⡀⠇⠀⡿⢸⠀⠀⣼⠕⢡⠏⡼⠿⣿⡤⠋⠋⠴⠣⢾⠞⣱⠋⠀⠀⠀",
  "⡀⠀⠀⠀⢙⣷⣄⡀⢠⡀⢢⡙⢄⠘⢮⡉⢩⡿⣿⣿⣻⡄⠀⣿⣵⡠⣴⣾⡿⠋⢁⡠⠤⠒⠒⠒⠤⢄⡀⠈⠻⣿⣿⣳⠇⠀⢰⡟⠊⡡⣾⡣⣦⠞⣡⠞⣠⢄⡴⣠⠞⠁⠀⠀⠀⠀",
  "⢈⣆⣴⡾⠛⠉⠻⢽⡲⣝⢦⡙⢦⣙⠂⠁⠀⠀⣬⣿⣿⣻⡄⠘⢿⣶⣿⠋⣠⣞⣁⣀⡤⠤⠤⠤⠤⠤⠬⣑⣄⣈⡻⠋⠀⢠⣿⣶⣫⢄⡠⢎⡡⠞⣥⣾⠕⣫⠞⠁⠀⠀⠀⠀⠀⠀",
  "⣽⣿⣿⣷⣄⠀⠀⠀⠙⢮⡓⠬⣓⠎⢁⠀⢀⡲⣬⡻⠭⣲⡽⣆⠀⠙⢷⡋⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⡼⠊⠀⠀⣠⠟⣯⠘⢚⣩⢴⣫⢞⡴⢉⡤⠞⠁⠀⠀⠀⠀⠀⠀⠀⠀",
  "⣿⣿⣿⣿⣿⣷⣄⠀⠀⠀⠉⠢⣌⠓⢬⣙⡲⢭⣓⡯⠽⠁⢀⡼⣳⣦⡀⠉⠑⠒⠤⠤⠤⠤⠤⠴⠒⠉⠁⠀⢀⣤⡞⣡⢿⣻⢅⠐⠺⠽⣚⡭⠖⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⢿⣿⣿⣿⡻⣿⣿⣿⣦⡀⠀⠀⠈⠳⣄⠀⠉⠓⠪⠭⢍⣰⢷⣯⣗⣊⢹⣶⣤⣀⠀⠒⠒⠒⠒⠒⠚⠉⣀⣤⣾⡟⣇⡇⢨⣿⠮⣻⠯⠖⠋⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠻⣿⣿⣿⣦⣍⡛⠻⢿⣦⡀⠀⠀⠀⠑⢤⡀⠀⠀⠀⠈⠙⠺⠯⠭⣼⠈⢻⣸⢿⢲⢢⢤⢤⢶⣶⣿⣿⣾⣿⠃⡼⡷⠒⠚⠉⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
  "⠀⠀⡈⠻⣿⣿⣿⣿⣷⣤⡹⣿⣦⣀⠀⠀⠀⠙⢦⡀⠀⠀⠀⠀⠀⠀⢸⠀⠀⢹⢼⢸⣸⢸⢸⢸⣿⡇⡟⡟⡣⠊⠀⣇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀",
];

const FRAME_MS = 200;

export function BootSplash(): React.ReactElement {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFrame((f) => f + 1), FRAME_MS);
    return () => clearInterval(t);
  }, []);
  const dots = ".".repeat((frame % 4) + 1);
  return (
    <Box flexDirection="column" alignItems="center" marginY={1}>
      <Box
        flexDirection="column"
        alignItems="center"
        borderStyle="round"
        borderColor={TONE.brand}
        paddingX={4}
        paddingY={1}
      >
        <Text color={TONE.warn} bold>
          {"BOUNTY: 1,500,000,000 BERRIES"}
        </Text>
        <Box height={1} />
        <Box flexDirection="column" alignItems="flex-start" marginBottom={1}>
          {RISING_LOGO.map((line) => (
            <Text key={line} color={TONE.brand} bold>
              {line}
            </Text>
          ))}
        </Box>
        <Box flexDirection="column" alignItems="flex-start">
          {SKULL_LINES.map((line) => (
            <Text key={line} color={TONE.brand} bold>
              {line}
            </Text>
          ))}
        </Box>
        <Box marginTop={1}>
          <Text color={FG.meta}>{`${t("common.loading")}${dots}`}</Text>
        </Box>
      </Box>
    </Box>
  );
}
