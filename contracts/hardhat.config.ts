import { defineConfig } from "hardhat/config";

// The vault is built and tested with Hardhat 3. Tests are Solidity files in
// ./test and use forge-std, so they also run under Arc Foundry
// (`arc-forge test --network arc`) with the foundry.toml next to this file.
export default defineConfig({
  paths: {
    sources: "./src",
    tests: { solidity: "./test" },
  },
  solidity: {
    version: "0.8.30",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // Arc targets the Osaka fork; Prague bytecode is a subset of it.
      evmVersion: "prague",
    },
  },
});
