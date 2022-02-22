const hre = require("hardhat");

async function main() {
  const Lottery = await hre.ethers.getContractFactory("Lottery");
  const lottery = await Lottery.deploy();

  await lottery.deployed();

  const { chainId } = await ethers.provider.getNetwork()

  console.log(JSON.stringify({chainId, "lotteryContractAddress": lottery.address}));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
