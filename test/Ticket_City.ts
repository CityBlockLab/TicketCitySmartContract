import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import hre from "hardhat";

describe("Ticket_City", () => {
  async function deployAndSetupFixture() {
    const [
      owner,
      organizer,
      attendee1,
      attendee2,
      attendee3,
      attendee4,
      unregisteredAttendee,
    ] = await hre.ethers.getSigners();

    // Deploy Ticket_City contract
    const TicketCity = await hre.ethers.getContractFactory("Ticket_City");
    const ticketCity = await TicketCity.deploy();
    await ticketCity.waitForDeployment();

    // Get current timestamp
    const currentTime = await time.latest();
    const startDate = currentTime + time.duration.days(1);
    const endDate = startDate + time.duration.days(7);

    // Setup event parameters
    const eventParams = {
      title: "Test Event",
      desc: "Test Description",
      startDate: startDate,
      endDate: endDate,
      expectedAttendees: 100,
      ticketType: 0, // FREE
    };

    return {
      ticketCity,
      owner,
      organizer,
      attendee1,
      attendee2,
      attendee3,
      attendee4,
      unregisteredAttendee,
      eventParams,
      currentTime,
    };
  }

  describe("Deployment", () => {
    it("Should set the right owner", async () => {
      const { ticketCity, owner } = await loadFixture(deployAndSetupFixture);
      expect(await ticketCity.owner()).to.equal(owner.address);
    });

    it("Should initialize counters to zero", async () => {
      const { ticketCity } = await loadFixture(deployAndSetupFixture);
      expect(await ticketCity.totalEventOrganised()).to.equal(0);
      expect(await ticketCity.totalTicketCreated()).to.equal(0);
      expect(await ticketCity.totalPurchasedTicket()).to.equal(0);
    });
  });

  describe("Event Organization", () => {
    it("Should create a free event successfully", async () => {
      const { ticketCity, organizer, eventParams } = await loadFixture(
        deployAndSetupFixture
      );

      await expect(
        ticketCity
          .connect(organizer)
          .createEvent(
            eventParams.title,
            eventParams.desc,
            eventParams.startDate,
            eventParams.endDate,
            eventParams.expectedAttendees,
            eventParams.ticketType
          )
      )
        .to.emit(ticketCity, "EventOrganized")
        .withArgs(organizer.address, 1, eventParams.ticketType);

      expect(await ticketCity.totalEventOrganised()).to.equal(1);
    });

    it("Should revert when creating event with invalid dates", async () => {
      const { ticketCity, organizer, eventParams, currentTime } =
        await loadFixture(deployAndSetupFixture);

      const invalidStartDate = currentTime - time.duration.days(1); // Past date

      await expect(
        ticketCity
          .connect(organizer)
          .createEvent(
            eventParams.title,
            eventParams.desc,
            invalidStartDate,
            eventParams.endDate,
            eventParams.expectedAttendees,
            eventParams.ticketType
          )
      ).to.be.revertedWithCustomError(ticketCity, "InvalidDates");
    });

    it("Should revert with zero expected attendees", async () => {
      const { ticketCity, organizer, eventParams } = await loadFixture(
        deployAndSetupFixture
      );

      await expect(
        ticketCity.connect(organizer).createEvent(
          eventParams.title,
          eventParams.desc,
          eventParams.startDate,
          eventParams.endDate,
          0, // Invalid expected attendees
          eventParams.ticketType
        )
      ).to.be.revertedWithCustomError(ticketCity, "ExpectedAttendeesIsTooLow");
    });
  });

  describe("Ticket Creation and Purchase", () => {
    it("Should mint free ticket", async () => {
      const { ticketCity, organizer, attendee1, eventParams } =
        await loadFixture(deployAndSetupFixture);

      // Create event
      await ticketCity
        .connect(organizer)
        .createEvent(
          eventParams.title,
          eventParams.desc,
          eventParams.startDate,
          eventParams.endDate,
          eventParams.expectedAttendees,
          eventParams.ticketType
        );

      // Create free ticket
      await expect(
        ticketCity.connect(organizer).createFreeTicket(
          1, // eventId
          "ipfs://test-uri"
        )
      )
        .to.emit(ticketCity, "TicketCreated")
        .withArgs(1, organizer.address, anyValue, 0, "FREE");

      // Purchase ticket
      await expect(
        ticketCity.connect(attendee1).purchaseTicket(
          1, // eventId
          0 // NONE category for free tickets
        )
      )
        .to.emit(ticketCity, "TicketPurchased")
        .withArgs(1, attendee1.address, 0);
    });

    it("Should create and purchase paid tickets", async () => {
      const { ticketCity, organizer, attendee1, eventParams } =
        await loadFixture(deployAndSetupFixture);

      // Log initial balance
      const initialBalance = await hre.ethers.provider.getBalance(
        attendee1.address
      );
      console.log(
        "Initial attendee1 balance:",
        hre.ethers.formatEther(initialBalance),
        "ETH"
      );

      // Create paid event
      await ticketCity.connect(organizer).createEvent(
        eventParams.title,
        eventParams.desc,
        eventParams.startDate,
        eventParams.endDate,
        eventParams.expectedAttendees,
        1 // PAID ticket type
      );

      // Create regular ticket
      const regularTicketFee = hre.ethers.parseEther("0.1");

      expect(
        await ticketCity.connect(organizer).createRegularTicket(
          1, // eventId
          regularTicketFee,
          "ipfs://regular-ticket"
        )
      )
        .to.emit(ticketCity, "TicketCreated")
        .withArgs(1, organizer.address, anyValue, regularTicketFee, "REGULAR");

      // Purchase ticket
      expect(
        await ticketCity.connect(attendee1).purchaseTicket(
          1, // eventId
          1, // REGULAR category
          { value: regularTicketFee }
        )
      )
        .to.emit(ticketCity, "TicketPurchased")
        .withArgs(1, attendee1.address, regularTicketFee);

      // Verify the purchase
      const eventDetails = await ticketCity.events(1);
      expect(eventDetails.userRegCount).to.equal(1);

      // confirm NFTticket
      const ticketDetails = await ticketCity.eventTickets(1);
      console.log(
        "Regular Ticket NFT Address:",
        ticketDetails.regularTicketNFT
      );
    });

    it("Should fail to purchase paid ticket with incorrect payment", async () => {
      const { ticketCity, organizer, attendee1, eventParams } =
        await loadFixture(deployAndSetupFixture);

      // Create paid event
      await ticketCity.connect(organizer).createEvent(
        eventParams.title,
        eventParams.desc,
        eventParams.startDate,
        eventParams.endDate,
        eventParams.expectedAttendees,
        1 // PAID ticket type
      );

      // Create regular ticket
      const regularTicketFee = hre.ethers.parseEther("0.1");
      await ticketCity
        .connect(organizer)
        .createRegularTicket(1, regularTicketFee, "ipfs://regular-ticket");

      // Try to purchase with incorrect fee
      const incorrectFee = hre.ethers.parseEther("0.05");
      await expect(
        ticketCity.connect(attendee1).purchaseTicket(
          1,
          1, // REGULAR category
          { value: incorrectFee }
        )
      ).to.be.revertedWith("Incorrect payment amount");
    });

    it("Should fail to purchase non-existent ticket category", async () => {
      const { ticketCity, organizer, attendee1, eventParams } =
        await loadFixture(deployAndSetupFixture);

      // Create paid event
      await ticketCity.connect(organizer).createEvent(
        eventParams.title,
        eventParams.desc,
        eventParams.startDate,
        eventParams.endDate,
        eventParams.expectedAttendees,
        1 // PAID ticket type
      );

      // Try to purchase VIP ticket when only REGULAR exists
      const ticketFee = hre.ethers.parseEther("0.1");
      await ticketCity
        .connect(organizer)
        .createRegularTicket(1, ticketFee, "ipfs://regular-ticket");

      await expect(
        ticketCity.connect(attendee1).purchaseTicket(
          1,
          2, // VIP category
          { value: ticketFee }
        )
      ).to.be.revertedWith("VIP tickets not available");
    });
  });

  describe("Ticket Purchase In Batches", function () {
    it("Should purchase multiple Regular tickets successfully", async function () {
      const {
        ticketCity,
        organizer,
        attendee1,
        attendee2,
        attendee3,
        eventParams,
      } = await loadFixture(deployAndSetupFixture);

      // Create an event
      await ticketCity.connect(organizer).createEvent(
        eventParams.title,
        eventParams.desc,
        eventParams.startDate,
        eventParams.endDate,
        eventParams.expectedAttendees,
        1 // 1 = Paid event
      );

      // Create Regular Tickets
      const regularTicketFee = hre.ethers.parseEther("0.1");

      await ticketCity.connect(organizer).createRegularTicket(
        1, // Event ID
        regularTicketFee,
        "ipfs://regular-ticket"
      );

      // Purchase Multiple Regular Tickets
      const recipients = [
        attendee1.address,
        attendee2.address,
        attendee3.address,
      ];
      const totalFee = regularTicketFee * BigInt(recipients.length);

      await expect(
        ticketCity
          .connect(organizer)
          .purchaseMultipleTickets(1, 1, recipients, { value: totalFee }) // 1 = Regular
      )
        .to.emit(ticketCity, "TicketPurchased")
        .withArgs(1, attendee1.address, regularTicketFee)
        .to.emit(ticketCity, "TicketPurchased")
        .withArgs(1, attendee2.address, regularTicketFee)
        .to.emit(ticketCity, "TicketPurchased")
        .withArgs(1, attendee3.address, regularTicketFee);

      // Verify Registration
      for (const recipient of recipients) {
        expect(await ticketCity.hasRegistered(recipient, 1)).to.be.true;
      }
    });

    it("Should purchase multiple VIP tickets successfully", async function () {
      const { ticketCity, organizer, attendee1, attendee2, eventParams } =
        await loadFixture(deployAndSetupFixture);

      // Create an event
      await ticketCity.connect(organizer).createEvent(
        eventParams.title,
        eventParams.desc,
        eventParams.startDate,
        eventParams.endDate,
        eventParams.expectedAttendees,
        1 // 1 = Paid event
      );

      // Create VIP Tickets
      const vipTicketFee = hre.ethers.parseEther("0.5");

      await ticketCity.connect(organizer).createVIPTicket(
        1, // Event ID
        vipTicketFee,
        "ipfs://vip-ticket"
      );

      // Purchase Multiple VIP Tickets
      const recipients = [attendee1.address, attendee2.address];
      const totalFee = vipTicketFee * BigInt(recipients.length);

      await expect(
        ticketCity
          .connect(organizer)
          .purchaseMultipleTickets(1, 2, recipients, { value: totalFee }) // 2 = VIP
      )
        .to.emit(ticketCity, "TicketPurchased")
        .withArgs(1, attendee1.address, vipTicketFee)
        .to.emit(ticketCity, "TicketPurchased")
        .withArgs(1, attendee2.address, vipTicketFee);

      // Verify Registration
      for (const recipient of recipients) {
        expect(await ticketCity.hasRegistered(recipient, 1)).to.be.true;
      }
    });

    it("Should revert if incorrect payment amount is sent", async function () {
      const { ticketCity, organizer, attendee1, attendee2, eventParams } =
        await loadFixture(deployAndSetupFixture);

      // Create an event
      await ticketCity.connect(organizer).createEvent(
        eventParams.title,
        eventParams.desc,
        eventParams.startDate,
        eventParams.endDate,
        eventParams.expectedAttendees,
        1 // 1 = Paid event
      );

      // Create Regular Tickets
      const regularTicketFee = hre.ethers.parseEther("0.1");

      await ticketCity.connect(organizer).createRegularTicket(
        1, // Event ID
        regularTicketFee,
        "ipfs://regular-ticket"
      );

      // Send incorrect payment
      const recipients = [attendee1.address, attendee2.address];
      const incorrectFee = regularTicketFee * BigInt(recipients.length - 1);

      await expect(
        ticketCity
          .connect(organizer)
          .purchaseMultipleTickets(1, 1, recipients, { value: incorrectFee }) // 1 = Regular
      ).to.be.revertedWith("Incorrect total payment amount");
    });

    it("Should revert if empty recipient list is provided", async function () {
      const { ticketCity, organizer, eventParams } = await loadFixture(
        deployAndSetupFixture
      );

      // Create an event
      await ticketCity.connect(organizer).createEvent(
        eventParams.title,
        eventParams.desc,
        eventParams.startDate,
        eventParams.endDate,
        eventParams.expectedAttendees,
        1 // 1 = Paid event
      );

      await expect(
        ticketCity
          .connect(organizer)
          .purchaseMultipleTickets(1, 1, [], { value: 0 }) // Empty array
      ).to.be.revertedWith("Empty recipients list");
    });

    it("Should revert if event has ended", async function () {
      const { ticketCity, organizer, attendee1, attendee2, eventParams } =
        await loadFixture(deployAndSetupFixture);

      // Create an event
      await ticketCity.connect(organizer).createEvent(
        eventParams.title,
        eventParams.desc,
        eventParams.startDate,
        eventParams.endDate,
        eventParams.expectedAttendees,
        1 // 1 = Paid event
      );

      // Move time beyond the event end date
      await time.increaseTo(eventParams.endDate + 1);

      const recipients = [attendee1.address, attendee2.address];

      await expect(
        ticketCity
          .connect(organizer)
          .purchaseMultipleTickets(1, 1, recipients, { value: 0 })
      ).to.be.revertedWithCustomError(ticketCity, "EventHasEnded");
    });

    it("Should revert if ticket purchase exceeds expected attendees limit", async function () {
      const {
        ticketCity,
        organizer,
        attendee1,
        attendee2,
        attendee3,
        attendee4,
        eventParams,
      } = await loadFixture(deployAndSetupFixture);

      // Set a small attendee limit
      eventParams.expectedAttendees = 3;

      // Create an event
      await ticketCity.connect(organizer).createEvent(
        eventParams.title,
        eventParams.desc,
        eventParams.startDate,
        eventParams.endDate,
        eventParams.expectedAttendees,
        1 // 1 = Paid event
      );

      // Create Regular Tickets
      const regularTicketFee = hre.ethers.parseEther("0.1");

      await ticketCity.connect(organizer).createRegularTicket(
        1, // Event ID
        regularTicketFee,
        "ipfs://regular-ticket"
      );

      // Attempt to register more than expected attendees
      const recipients = [
        attendee1.address,
        attendee2.address,
        attendee3.address,
        attendee4.address,
      ];
      const totalFee = regularTicketFee * BigInt(recipients.length);

      await expect(
        ticketCity
          .connect(organizer)
          .purchaseMultipleTickets(1, 1, recipients, { value: totalFee })
      ).to.be.revertedWithCustomError(ticketCity, "RegistrationHasClosed");
    });
  });

  describe("Attendance Verification", () => {
    it("Should verify attendance for valid free ticket holder", async () => {
      const { ticketCity, organizer, attendee1, eventParams } =
        await loadFixture(deployAndSetupFixture);

      // Create and setup event
      await ticketCity
        .connect(organizer)
        .createEvent(
          eventParams.title,
          eventParams.desc,
          eventParams.startDate,
          eventParams.endDate,
          eventParams.expectedAttendees,
          eventParams.ticketType
        );

      // Create Free Ticket
      await ticketCity
        .connect(organizer)
        .createFreeTicket(1, "ipfs://test-uri");

      // Log the Free Ticket NFT Address
      const eventDetails = await ticketCity.events(1);
      console.log("Free Ticket NFT Address:", eventDetails.ticketNFTAddr);

      // Purchase Free Ticket
      await ticketCity.connect(attendee1).purchaseTicket(1, 0);

      // Move time to event start date
      await time.increaseTo(eventParams.startDate);

      // Verify attendance
      await expect(ticketCity.connect(attendee1).verifyAttendance(1))
        .to.emit(ticketCity, "AttendeeVerified")
        .withArgs(1, attendee1.address, anyValue);
    });

    it("Should verify attendance for Regular and VIP ticket holders", async function () {
      const { ticketCity, organizer, attendee1, attendee2, eventParams } =
        await loadFixture(deployAndSetupFixture);

      // Create a paid event
      await ticketCity.connect(organizer).createEvent(
        eventParams.title,
        eventParams.desc,
        eventParams.startDate,
        eventParams.endDate,
        eventParams.expectedAttendees,
        1 // 1 = Paid event
      );

      // Create Regular and VIP tickets
      const regularTicketFee = hre.ethers.parseEther("0.1");
      const vipTicketFee = hre.ethers.parseEther("0.5");

      await expect(
        ticketCity.connect(organizer).createRegularTicket(
          1, // Event ID
          regularTicketFee,
          "ipfs://regular-ticket"
        )
      )
        .to.emit(ticketCity, "TicketCreated")
        .withArgs(1, organizer.address, anyValue, regularTicketFee, "REGULAR");

      await expect(
        ticketCity.connect(organizer).createVIPTicket(
          1, // Event ID
          vipTicketFee,
          "ipfs://vip-ticket"
        )
      )
        .to.emit(ticketCity, "TicketCreated")
        .withArgs(1, organizer.address, anyValue, vipTicketFee, "VIP");

      // Purchase Regular and VIP tickets
      await expect(
        ticketCity
          .connect(attendee1)
          .purchaseTicket(1, 1, { value: regularTicketFee }) // 1 = Regular
      )
        .to.emit(ticketCity, "TicketPurchased")
        .withArgs(1, attendee1.address, regularTicketFee);

      await expect(
        ticketCity
          .connect(attendee2)
          .purchaseTicket(1, 2, { value: vipTicketFee }) // 2 = VIP
      )
        .to.emit(ticketCity, "TicketPurchased")
        .withArgs(1, attendee2.address, vipTicketFee);

      // Ensure tickets were assigned
      const regularBalance = await ticketCity.eventTickets(1);
      console.log("Regular Ticket NFT:", regularBalance.regularTicketNFT);

      const vipBalance = await ticketCity.eventTickets(1);
      console.log("VIP Ticket NFT:", vipBalance.vipTicketNFT);

      // Move time to event start
      await time.increaseTo(eventParams.startDate);

      // Verify Attendance for Regular Ticket Holder
      await expect(ticketCity.connect(attendee1).verifyAttendance(1))
        .to.emit(ticketCity, "AttendeeVerified")
        .withArgs(1, attendee1.address, anyValue);

      // Verify Attendance for VIP Ticket Holder
      await expect(ticketCity.connect(attendee2).verifyAttendance(1))
        .to.emit(ticketCity, "AttendeeVerified")
        .withArgs(1, attendee2.address, anyValue);
    });
  });

  describe("Group Attendance Verification", function () {
    it("Should verify attendance for multiple Regular ticket holders", async function () {
      const {
        ticketCity,
        organizer,
        attendee1,
        attendee2,
        attendee3,
        eventParams,
      } = await loadFixture(deployAndSetupFixture);

      // Create an event
      await ticketCity.connect(organizer).createEvent(
        eventParams.title,
        eventParams.desc,
        eventParams.startDate,
        eventParams.endDate,
        eventParams.expectedAttendees,
        1 // 1 = Paid event
      );

      // Create Regular Tickets
      const regularTicketFee = hre.ethers.parseEther("0.1");

      await ticketCity.connect(organizer).createRegularTicket(
        1, // Event ID
        regularTicketFee,
        "ipfs://regular-ticket"
      );

      // Purchase Regular Tickets
      const recipients = [
        attendee1.address,
        attendee2.address,
        attendee3.address,
      ];
      const totalFee = regularTicketFee * BigInt(recipients.length);

      await ticketCity
        .connect(organizer)
        .purchaseMultipleTickets(1, 1, recipients, { value: totalFee }); // 1 = Regular

      // Move time to event start
      await time.increaseTo(eventParams.startDate);

      // Verify attendance for multiple attendees
      await expect(
        ticketCity.connect(organizer).verifyGroupAttendance(1, recipients)
      )
        .to.emit(ticketCity, "AttendeeVerified")
        .withArgs(1, attendee1.address, anyValue)
        .to.emit(ticketCity, "AttendeeVerified")
        .withArgs(1, attendee2.address, anyValue)
        .to.emit(ticketCity, "AttendeeVerified")
        .withArgs(1, attendee3.address, anyValue);

      // Ensure all attendees are marked as verified
      for (const recipient of recipients) {
        expect(await ticketCity.isVerified(recipient, 1)).to.be.true;
      }
    });

    it("Should verify attendance for multiple VIP ticket holders", async function () {
      const { ticketCity, organizer, attendee1, attendee2, eventParams } =
        await loadFixture(deployAndSetupFixture);

      // Create an event
      await ticketCity.connect(organizer).createEvent(
        eventParams.title,
        eventParams.desc,
        eventParams.startDate,
        eventParams.endDate,
        eventParams.expectedAttendees,
        1 // 1 = Paid event
      );

      // Create VIP Tickets
      const vipTicketFee = hre.ethers.parseEther("0.5");

      await ticketCity.connect(organizer).createVIPTicket(
        1, // Event ID
        vipTicketFee,
        "ipfs://vip-ticket"
      );

      // Purchase VIP Tickets
      const recipients = [attendee1.address, attendee2.address];
      const totalFee = vipTicketFee * BigInt(recipients.length);

      await ticketCity
        .connect(organizer)
        .purchaseMultipleTickets(1, 2, recipients, { value: totalFee }); // 2 = VIP

      // Move time to event start
      await time.increaseTo(eventParams.startDate);

      // Verify attendance for multiple attendees
      await expect(
        ticketCity.connect(organizer).verifyGroupAttendance(1, recipients)
      )
        .to.emit(ticketCity, "AttendeeVerified")
        .withArgs(1, attendee1.address, anyValue)
        .to.emit(ticketCity, "AttendeeVerified")
        .withArgs(1, attendee2.address, anyValue);

      // Ensure all attendees are marked as verified
      for (const recipient of recipients) {
        expect(await ticketCity.isVerified(recipient, 1)).to.be.true;
      }
    });

    it("Should skip already verified attendees", async function () {
      const { ticketCity, organizer, attendee1, attendee2, eventParams } =
        await loadFixture(deployAndSetupFixture);

      // Create an event
      await ticketCity.connect(organizer).createEvent(
        eventParams.title,
        eventParams.desc,
        eventParams.startDate,
        eventParams.endDate,
        eventParams.expectedAttendees,
        1 // 1 = Paid event
      );

      // Create Regular Tickets
      const regularTicketFee = hre.ethers.parseEther("0.1");

      await ticketCity.connect(organizer).createRegularTicket(
        1, // Event ID
        regularTicketFee,
        "ipfs://regular-ticket"
      );

      // Purchase Regular Tickets
      const recipients = [attendee1.address, attendee2.address];
      const totalFee = regularTicketFee * BigInt(recipients.length);

      await ticketCity
        .connect(organizer)
        .purchaseMultipleTickets(1, 1, recipients, { value: totalFee }); // 1 = Regular

      // Move time to event start
      await time.increaseTo(eventParams.startDate);

      // Verify attendance for attendee1 first
      await ticketCity.connect(attendee1).verifyAttendance(1);

      // Attempt group verification again
      await expect(
        ticketCity.connect(organizer).verifyGroupAttendance(1, recipients)
      )
        .to.emit(ticketCity, "AttendeeVerified")
        .withArgs(1, attendee2.address, anyValue);

      // Ensure both attendees are verified in the end
      expect(await ticketCity.isVerified(attendee1.address, 1)).to.be.true;
      expect(await ticketCity.isVerified(attendee2.address, 1)).to.be.true;
    });

    it("Should revert if empty attendees list is provided", async function () {
      const { ticketCity, organizer, eventParams } = await loadFixture(
        deployAndSetupFixture
      );

      // Create an event
      await ticketCity.connect(organizer).createEvent(
        eventParams.title,
        eventParams.desc,
        eventParams.startDate,
        eventParams.endDate,
        eventParams.expectedAttendees,
        1 // 1 = Paid event
      );

      // Move time to event start
      await time.increaseTo(eventParams.startDate);

      // Attempt to verify with empty list
      await expect(
        ticketCity.connect(organizer).verifyGroupAttendance(1, [])
      ).to.be.revertedWithCustomError(ticketCity, "EmptyAttendeesList");
    });

    it("Should skip unregistered attendees", async function () {
      const {
        ticketCity,
        organizer,
        attendee1,
        attendee2,
        unregisteredAttendee,
        eventParams,
      } = await loadFixture(deployAndSetupFixture);

      // Create an event
      await ticketCity.connect(organizer).createEvent(
        eventParams.title,
        eventParams.desc,
        eventParams.startDate,
        eventParams.endDate,
        eventParams.expectedAttendees,
        1 // 1 = Paid event
      );

      // Create Regular Tickets
      const regularTicketFee = hre.ethers.parseEther("0.1");

      await ticketCity.connect(organizer).createRegularTicket(
        1, // Event ID
        regularTicketFee,
        "ipfs://regular-ticket"
      );

      // Purchase Regular Tickets
      const recipients = [attendee1.address, attendee2.address];
      const totalFee = regularTicketFee * BigInt(recipients.length);

      await ticketCity
        .connect(organizer)
        .purchaseMultipleTickets(1, 1, recipients, { value: totalFee }); // 1 = Regular

      // Move time to event start
      await time.increaseTo(eventParams.startDate);

      // Attempt group verification including an unregistered attendee
      await expect(
        ticketCity
          .connect(organizer)
          .verifyGroupAttendance(1, [
            attendee1.address,
            attendee2.address,
            unregisteredAttendee.address,
          ])
      )
        .to.emit(ticketCity, "AttendeeVerified")
        .withArgs(1, attendee1.address, anyValue)
        .to.emit(ticketCity, "AttendeeVerified")
        .withArgs(1, attendee2.address, anyValue);

      // Ensure only registered attendees are verified
      expect(await ticketCity.isVerified(attendee1.address, 1)).to.be.true;
      expect(await ticketCity.isVerified(attendee2.address, 1)).to.be.true;
      expect(await ticketCity.isVerified(unregisteredAttendee.address, 1)).to.be
        .false;
    });
  });

  describe("Revenue Management", () => {
    it("Should handle revenue release correctly", async () => {
      const { ticketCity, owner, organizer, attendee1, eventParams } =
        await loadFixture(deployAndSetupFixture);

      // Create paid event
      await ticketCity.connect(organizer).createEvent(
        eventParams.title,
        eventParams.desc,
        eventParams.startDate,
        eventParams.endDate,
        eventParams.expectedAttendees,
        1 // PAID
      );

      // Create and purchase regular ticket
      const ticketFee = hre.ethers.parseEther("0.1");
      await ticketCity
        .connect(organizer)
        .createRegularTicket(1, ticketFee, "ipfs://test-uri");
      await ticketCity
        .connect(attendee1)
        .purchaseTicket(1, 1, { value: ticketFee });

      // Move to event start and verify attendance
      await time.increaseTo(eventParams.startDate);
      await ticketCity.connect(attendee1).verifyAttendance(1);

      // Move past event end
      await time.increaseTo(eventParams.endDate + 1);

      // Check revenue release conditions
      const [canRelease, attendanceRate, revenue] =
        await ticketCity.canReleaseRevenue(1);
      expect(revenue).to.equal(ticketFee);
    });
  });
});
