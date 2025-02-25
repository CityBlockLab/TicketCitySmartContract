import { ethers } from "hardhat";

async function main() {
  const ticketCity = await ethers.deployContract("Ticket_City");

  await ticketCity.waitForDeployment();

  console.log({
    "Ticket_City contract successfully deployed to": ticketCity.target,
  });
}

main().catch((error: any) => {
  console.error(error);
  process.exitCode = 1;
});
