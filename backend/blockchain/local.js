const path = require("node:path");
const { HDNodeWallet } = require("ethers");
const directory = path.join(__dirname, "../../blockchain/.local");
// Public development mnemonic. Never fund these accounts on a public network.
const mnemonic = "test test test test test test test test test test test junk";
const relayer = HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/60'/0'/0/1");
module.exports = { directory, mnemonic, relayer, chainId: 31337 };
