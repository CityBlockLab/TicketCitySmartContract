import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import hre from "hardhat";

describe("Ticket_City", () => {
  const deployTicketCityFixture = async () => {
    const [owner, otherAccount] = await hre.ethers.getSigners();

    return { owner, otherAccount };
  };

  describe("Deployment", function () {});
});
