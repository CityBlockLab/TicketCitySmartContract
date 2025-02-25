// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "./interfaces/ITicket_NFT.sol";
import "./Ticket_NFT.sol";
import "./libraries/Types.sol";
import "./libraries/Errors.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Multicall.sol";

/**
 * @dev Implementation of a decentralized ticketing system for events.
 *
 * This contract enables event organizers to create and manage events with different
 * ticket types (free, regular, VIP). It handles ticket sales, attendance verification,
 * and revenue distribution based on attendance rates.
 *
 * Key features include:
 * - Event creation and management
 * - Multiple ticket types (FREE, REGULAR, VIP)
 * - NFT-based ticket issuance
 * - Attendance verification system
 * - Revenue release mechanism with attendance thresholds
 */
contract Ticket_City is Multicall, ReentrancyGuard {
    using Types for *;
    using Errors for *;

    address payable public owner;
    uint256 public totalEventOrganised;
    uint256 public totalTicketCreated;
    uint public totalPurchasedTicket;
    uint public constant FREE_TICKET_PRICE = 0;
    uint256 public constant MINIMUM_ATTENDANCE_RATE = 60; // 60%

    Types.EventDetails[] private allEvents;

    /**
     * @dev Maps event IDs to their details
     */
    mapping(uint256 => Types.EventDetails) public events;

    /**
     * @dev Tracks if an address has registered for a specific event
     */
    mapping(address => mapping(uint256 => bool)) public hasRegistered;

    /**
     * @dev Tracks revenue balance for organizers per event
     */
    mapping(address => mapping(uint256 => uint256)) internal organiserRevBal;

    /**
     * @dev Maps event IDs to their ticket types and details
     */
    mapping(uint256 => Types.TicketTypes) public eventTickets;

    /**
     * @dev Tracks attendance verification status for each address per event
     */
    mapping(address => mapping(uint256 => bool)) public isVerified;

    /**
     * @dev Tracks if revenue has been released for an event
     */
    mapping(uint256 => bool) private revenueReleased;

    /**
     * @dev Emitted when a new event is organized
     */
    event EventOrganized(
        address indexed _organiser,
        uint256 indexed _eventId,
        Types.TicketType _ticketType
    );

    /**
     * @dev Emitted when a new ticket type is created for an event
     */
    event TicketCreated(
        uint256 indexed _eventId,
        address indexed _organiser,
        address _ticketNFTAddr,
        uint256 _ticketFee,
        string _ticketType
    );

    /**
     * @dev Emitted when a ticket is purchased
     */
    event TicketPurchased(
        uint256 indexed _eventId,
        address indexed _buyer,
        uint256 _ticketFee
    );

    /**
     * @dev Emitted when an attendee's presence is verified
     */
    event AttendeeVerified(
        uint256 indexed _eventId,
        address indexed _attendee,
        uint256 _verificationTime
    );

    /**
     * @dev Emitted when event revenue is released to organizer
     */
    event RevenueReleased(
        uint256 indexed _eventId,
        address indexed _organiser,
        uint256 _amount,
        uint256 _attendanceRate,
        bool _manuallyReleased
    );

    /**
     * @dev Emitted when event revenue is released to organizer
     */
    event EtherReceived(address indexed _from, uint _amount);

    /**
     * @dev Sets the contract deployer as the owner
     */
    constructor() payable {
        owner = payable(msg.sender);
    }

    /**
     * @dev Allow the contract to receive ethers
     */
    receive() external payable {
        emit EtherReceived(msg.sender, msg.value);
    }

    /**
     * @dev Creates a new NFT ticket contract for an event
     * @param _eventId The ID of the event
     * @param _ticketFee The price of the ticket
     * @param _ticketUri The URI for the ticket metadata
     * @param _ticketType The type of ticket (FREE, REGULAR, or VIP)
     * @return Address of the newly created ticket NFT contract
     */
    function _createTicket(
        uint256 _eventId,
        uint256 _ticketFee,
        string memory _ticketUri,
        string memory _ticketType
    ) internal returns (address) {
        Types.EventDetails storage eventDetails = events[_eventId];

        string memory ticketName = eventDetails.title;
        address newTicketNFT = address(
            new Ticket_NFT(address(this), _ticketUri, ticketName, _ticketType)
        );

        eventDetails.ticketNFTAddr = newTicketNFT;
        eventDetails.ticketFee = _ticketFee;
        organiserRevBal[eventDetails.organiser][_eventId] += 0;

        return newTicketNFT;
    }

    /**
     * @dev Validates event existence and organizer authorization
     * @param _eventId The ID of the event to validate
     */
    function _validateEventAndOrganizer(uint256 _eventId) internal view {
        if (msg.sender == address(0)) revert Errors.AddressZeroDetected();
        if (_eventId == 0 || _eventId > totalEventOrganised)
            revert Errors.EventDoesNotExist();
        if (msg.sender != events[_eventId].organiser)
            revert Errors.OnlyOrganiserCanCreateTicket();
    }

    /**
     * @dev Creates a new event
     * @param _title Event title
     * @param _desc Event description
     * @param _startDate Event start timestamp
     * @param _endDate Event end timestamp
     * @param _expectedAttendees Expected number of attendees
     * @param _ticketType Type of tickets for the event (FREE or PAID)
     */
    function createEvent(
        string memory _title,
        string memory _desc,
        string memory _imageUri,
        string memory _location,
        uint256 _startDate,
        uint256 _endDate,
        uint256 _expectedAttendees,
        Types.TicketType _ticketType
    ) external returns (uint256) {
        // Input validation
        if (msg.sender == address(0)) revert Errors.AddressZeroDetected();
        if (bytes(_title).length == 0 || bytes(_desc).length == 0)
            revert Errors.EmptyTitleOrDescription();
        if (_startDate >= _endDate || _startDate < block.timestamp)
            revert Errors.InvalidDates();
        if (_expectedAttendees == 0) revert Errors.ExpectedAttendeesIsTooLow();

        uint256 eventId = totalEventOrganised + 1;
        totalEventOrganised = eventId;

        Types.EventDetails storage eventDetails = events[eventId];
        eventDetails.title = _title;
        eventDetails.desc = _desc;
        eventDetails.imageUri = _imageUri;
        eventDetails.location = _location;
        eventDetails.startDate = _startDate;
        eventDetails.endDate = _endDate;
        eventDetails.expectedAttendees = _expectedAttendees;
        eventDetails.ticketType = _ticketType;

        // Initialize other values to zero
        eventDetails.userRegCount = 0;
        eventDetails.verifiedAttendeesCount = 0;
        eventDetails.ticketFee = 0;
        eventDetails.ticketNFTAddr = address(0);

        // Set paid ticket category based on ticket type
        if (_ticketType == Types.TicketType.PAID) {
            eventDetails.paidTicketCategory = Types.PaidTicketCategory.NONE; // Will be set when creating specific ticket types
        } else {
            eventDetails.paidTicketCategory = Types.PaidTicketCategory.NONE;
        }

        eventDetails.organiser = msg.sender;

        allEvents.push(eventDetails);

        emit EventOrganized(msg.sender, eventId, _ticketType);

        return eventId;
    }

    function createTicket(
        uint256 _eventId,
        Types.PaidTicketCategory _category,
        uint256 _ticketFee,
        string memory _ticketUri
    ) external {
        _validateEventAndOrganizer(_eventId);

        Types.EventDetails storage eventDetails = events[_eventId];
        Types.TicketTypes storage tickets = eventTickets[_eventId];

        // Handle FREE tickets
        if (_category == Types.PaidTicketCategory.NONE) {
            if (eventDetails.ticketType != Types.TicketType.FREE) {
                revert Errors.FreeTicketForFreeEventOnly();
            }

            address newTicketNFT = _createTicket(
                _eventId,
                FREE_TICKET_PRICE,
                _ticketUri,
                "FREE"
            );

            totalTicketCreated++;

            emit TicketCreated(
                _eventId,
                msg.sender,
                newTicketNFT,
                FREE_TICKET_PRICE,
                "FREE"
            );
            return;
        }

        // Handle PAID tickets
        if (eventDetails.ticketType != Types.TicketType.PAID) {
            revert Errors.YouCanNotCreateThisTypeOfTicketForThisEvent();
        }
        if (_ticketFee == 0) revert Errors.InvalidTicketFee();

        if (_category == Types.PaidTicketCategory.REGULAR) {
            if (tickets.hasRegularTicket)
                revert("Regular tickets already created");
            if (tickets.hasVIPTicket && _ticketFee >= tickets.vipTicketFee) {
                revert Errors.RegularTicketMustCostLessThanVipTicket();
            }

            address newTicketNFT = _createTicket(
                _eventId,
                _ticketFee,
                _ticketUri,
                "REGULAR"
            );

            tickets.hasRegularTicket = true;
            tickets.regularTicketFee = _ticketFee;
            tickets.regularTicketNFT = newTicketNFT;

            totalTicketCreated++;

            emit TicketCreated(
                _eventId,
                msg.sender,
                newTicketNFT,
                _ticketFee,
                "REGULAR"
            );
        } else if (_category == Types.PaidTicketCategory.VIP) {
            if (tickets.hasVIPTicket) revert("VIP tickets already created");
            if (
                tickets.hasRegularTicket &&
                _ticketFee <= tickets.regularTicketFee
            ) {
                revert Errors.VipFeeTooLow();
            }

            address newTicketNFT = _createTicket(
                _eventId,
                _ticketFee,
                _ticketUri,
                "VIP"
            );

            tickets.hasVIPTicket = true;
            tickets.vipTicketFee = _ticketFee;
            tickets.vipTicketNFT = newTicketNFT;

            totalTicketCreated++;

            emit TicketCreated(
                _eventId,
                msg.sender,
                newTicketNFT,
                _ticketFee,
                "VIP"
            );
        }
    }

    function purchaseTicket(
        uint256 _eventId,
        Types.PaidTicketCategory _category
    ) external payable {
        Types.EventDetails storage eventDetails = events[_eventId];
        if (hasRegistered[msg.sender][_eventId])
            revert Errors.AlreadyRegistered();
        if (eventDetails.endDate < block.timestamp)
            revert Errors.EventHasEnded();
        if (eventDetails.userRegCount >= eventDetails.expectedAttendees)
            revert Errors.RegistrationHasClosed();

        Types.TicketTypes storage tickets = eventTickets[_eventId];
        address ticketNFTAddr;
        uint256 requiredFee;

        if (eventDetails.ticketType == Types.TicketType.FREE) {
            if (_category != Types.PaidTicketCategory.NONE)
                revert Errors.FreeTicketForFreeEventOnly();
            ticketNFTAddr = eventDetails.ticketNFTAddr;
            requiredFee = 0;
        } else {
            // Handle paid tickets
            if (_category == Types.PaidTicketCategory.REGULAR) {
                if (!tickets.hasRegularTicket)
                    revert("Regular tickets not available");
                ticketNFTAddr = tickets.regularTicketNFT;
                requiredFee = tickets.regularTicketFee;
            } else if (_category == Types.PaidTicketCategory.VIP) {
                if (!tickets.hasVIPTicket) revert("VIP tickets not available");
                ticketNFTAddr = tickets.vipTicketNFT;
                requiredFee = tickets.vipTicketFee;
            } else {
                revert("Invalid ticket category");
            }

            if (msg.value != requiredFee) revert("Incorrect payment amount");
            // Transfer payment to contract
            (bool success, ) = address(this).call{value: msg.value}("");
            require(success, "Payment failed");
        }

        require(ticketNFTAddr != address(0), "Ticket contract not set");

        // Mint NFT ticket
        ITicket_NFT ticketContract = ITicket_NFT(ticketNFTAddr);
        ticketContract.safeMint(msg.sender);

        // Update event details
        eventDetails.userRegCount += 1;
        hasRegistered[msg.sender][_eventId] = true;

        // Update organizer revenue balance
        organiserRevBal[eventDetails.organiser][_eventId] += msg.value;

        totalPurchasedTicket + 1;

        emit TicketPurchased(_eventId, msg.sender, requiredFee);
    }

    function purchaseMultipleTickets(
        uint256 _eventId,
        Types.PaidTicketCategory _category,
        address[] calldata _recipients
    ) external payable {
        Types.EventDetails storage eventDetails = events[_eventId];
        if (eventDetails.endDate < block.timestamp)
            revert Errors.EventHasEnded();
        if (_recipients.length == 0) revert("Empty recipients list");
        if (
            eventDetails.userRegCount + _recipients.length >
            eventDetails.expectedAttendees
        ) revert Errors.RegistrationHasClosed();

        Types.TicketTypes storage tickets = eventTickets[_eventId];
        address ticketNFTAddr;
        uint256 requiredFeePerTicket;

        if (eventDetails.ticketType == Types.TicketType.FREE) {
            if (_category != Types.PaidTicketCategory.NONE)
                revert Errors.FreeTicketForFreeEventOnly();
            ticketNFTAddr = eventDetails.ticketNFTAddr;
            requiredFeePerTicket = 0;
        } else {
            if (_category == Types.PaidTicketCategory.REGULAR) {
                if (!tickets.hasRegularTicket)
                    revert("Regular tickets not available");
                ticketNFTAddr = tickets.regularTicketNFT;
                requiredFeePerTicket = tickets.regularTicketFee;
            } else if (_category == Types.PaidTicketCategory.VIP) {
                if (!tickets.hasVIPTicket) revert("VIP tickets not available");
                ticketNFTAddr = tickets.vipTicketNFT;
                requiredFeePerTicket = tickets.vipTicketFee;
            } else {
                revert("Invalid ticket category");
            }

            // Verify total payment
            if (msg.value != requiredFeePerTicket * _recipients.length)
                revert("Incorrect total payment amount");
        }

        require(ticketNFTAddr != address(0), "Ticket contract not set");
        ITicket_NFT ticketContract = ITicket_NFT(ticketNFTAddr);

        // Process each recipient NFTs
        for (uint256 i = 0; i < _recipients.length; i++) {
            address recipient = _recipients[i];

            // Skip if recipient has already registered
            if (hasRegistered[recipient][_eventId]) continue;

            // Mint NFT ticket
            ticketContract.safeMint(recipient);

            // Update registration status
            hasRegistered[recipient][_eventId] = true;
            eventDetails.userRegCount += 1;
            totalPurchasedTicket += 1;

            emit TicketPurchased(_eventId, recipient, requiredFeePerTicket);
        }

        // Transfer total payment to contract if paid event
        if (requiredFeePerTicket > 0) {
            organiserRevBal[eventDetails.organiser][_eventId] += msg.value;
        }
    }

    // Verifications
    function verifyAttendance(uint256 _eventId) external {
        Types.EventDetails storage eventDetails = events[_eventId];

        // Validate if event exist or has started
        if (_eventId == 0 || _eventId > totalEventOrganised)
            revert Errors.EventDoesNotExist();
        if (block.timestamp < eventDetails.startDate)
            revert Errors.EventNotStarted();

        // Check if attendee is registered
        if (!hasRegistered[msg.sender][_eventId])
            revert Errors.NotRegisteredForEvent();

        // Check if already verified
        if (isVerified[msg.sender][_eventId]) revert Errors.AlreadyVerified();

        // Get ticket information
        Types.TicketTypes storage tickets = eventTickets[_eventId];
        bool hasValidTicket = false;

        // Check for regular ticket ownership
        if (eventDetails.ticketType == Types.TicketType.FREE) {
            hasValidTicket = true;
        }

        if (
            tickets.hasRegularTicket && tickets.regularTicketNFT != address(0)
        ) {
            try
                ITicket_NFT(tickets.regularTicketNFT).balanceOf(msg.sender)
            returns (uint256 balance) {
                if (balance > 0) {
                    hasValidTicket = true;
                }
            } catch {
                // If the call fails, continue to check VIP ticket
            }
        }

        // Check for VIP ticket ownership if no regular ticket was found
        if (
            !hasValidTicket &&
            tickets.hasVIPTicket &&
            tickets.vipTicketNFT != address(0)
        ) {
            try
                ITicket_NFT(tickets.vipTicketNFT).balanceOf(msg.sender)
            returns (uint256 balance) {
                if (balance > 0) {
                    hasValidTicket = true;
                }
            } catch {
                // If the call fails, the next require statement will handle it
            }
        }

        require(hasValidTicket, "No valid ticket found");

        // Mark attendee as verified
        isVerified[msg.sender][_eventId] = true;
        eventDetails.verifiedAttendeesCount += 1;

        emit AttendeeVerified(_eventId, msg.sender, block.timestamp);
    }

    function verifyGroupAttendance(
        uint256 _eventId,
        address[] calldata _attendees
    ) external {
        Types.EventDetails storage eventDetails = events[_eventId];

        if (_eventId == 0 || _eventId > totalEventOrganised)
            revert Errors.EventDoesNotExist();
        if (block.timestamp < eventDetails.startDate)
            revert Errors.EventNotStarted();
        if (_attendees.length == 0) revert Errors.EmptyAttendeesList();

        // Get ticket information
        Types.TicketTypes storage tickets = eventTickets[_eventId];

        // Process each attendee
        for (uint256 i = 0; i < _attendees.length; i++) {
            address attendee = _attendees[i];

            // Skip if already verified or not registered
            if (
                isVerified[attendee][_eventId] ||
                !hasRegistered[attendee][_eventId]
            ) continue;

            bool hasValidTicket = false;

            // Check for regular ticket ownership
            if (
                tickets.hasRegularTicket &&
                tickets.regularTicketNFT != address(0)
            ) {
                try
                    ITicket_NFT(tickets.regularTicketNFT).balanceOf(attendee)
                returns (uint256 balance) {
                    if (balance > 0) hasValidTicket = true;
                } catch {}
            }

            // Check for VIP ticket if no regular ticket
            if (
                !hasValidTicket &&
                tickets.hasVIPTicket &&
                tickets.vipTicketNFT != address(0)
            ) {
                try
                    ITicket_NFT(tickets.vipTicketNFT).balanceOf(attendee)
                returns (uint256 balance) {
                    if (balance > 0) hasValidTicket = true;
                } catch {}
            }

            // Skip if no valid ticket found
            if (!hasValidTicket) continue;

            // Mark attendee as verified
            isVerified[attendee][_eventId] = true;
            eventDetails.verifiedAttendeesCount += 1;

            emit AttendeeVerified(_eventId, attendee, block.timestamp);
        }
    }

    // check verification status
    // function isAttendeeVerified(
    //     uint256 _eventId,
    //     address _attendee
    // ) external view returns (bool) {
    //     return isVerified[_attendee][_eventId];
    // }

    function releaseRevenue(uint256 _eventId) external nonReentrant {
        Types.EventDetails storage eventDetails = events[_eventId];

        // Check if event exist or has ended
        if (_eventId == 0 || _eventId > totalEventOrganised)
            revert Errors.EventDoesNotExist();
        if (block.timestamp <= eventDetails.endDate)
            revert Errors.EventNotEnded();

        // Check if revenue was already released
        if (revenueReleased[_eventId]) revert Errors.RevenueAlreadyReleased();

        // Check if there's revenue to release
        uint256 revenue = organiserRevBal[eventDetails.organiser][_eventId];
        if (revenue == 0) revert Errors.NoRevenueToRelease();

        // Calculate attendance rate
        uint256 attendanceRate = (eventDetails.verifiedAttendeesCount * 100) /
            eventDetails.userRegCount;

        // Only owner can release if attendance rate is below minimum
        if (attendanceRate < MINIMUM_ATTENDANCE_RATE) {
            if (msg.sender != owner) revert Errors.OnlyOwnerCanRelease();
        } else {
            // For automatic release, only organizer can trigger
            if (msg.sender != eventDetails.organiser)
                revert Errors.NotEventOrganizer();
        }

        // Mark revenue as released
        revenueReleased[_eventId] = true;

        // Reset organiser balance before transfer
        organiserRevBal[eventDetails.organiser][_eventId] = 0;

        // Transfer revenue
        (bool success, ) = eventDetails.organiser.call{value: revenue}("");
        require(success, "Revenue transfer failed");

        emit RevenueReleased(
            _eventId,
            eventDetails.organiser,
            revenue,
            attendanceRate,
            msg.sender == owner
        );
    }

    // Getter functions
    // View functions to get an event and all events
    function getEvent(
        uint256 _eventId
    ) public view returns (Types.EventDetails memory eventDetails) {
        return eventDetails = events[_eventId];
    }

    function getAllEvents()
        external
        view
        returns (Types.EventDetails[] memory)
    {
        return allEvents;
    }

    // View function to check if revenue can be automatically released
    function canReleaseRevenue(
        uint256 _eventId
    )
        external
        view
        returns (bool canRelease, uint256 attendanceRate, uint256 revenue)
    {
        Types.EventDetails storage eventDetails = events[_eventId];

        if (
            block.timestamp <= eventDetails.endDate || revenueReleased[_eventId]
        ) {
            return (false, 0, 0);
        }

        revenue = organiserRevBal[eventDetails.organiser][_eventId];
        if (revenue == 0) {
            return (false, 0, 0);
        }

        attendanceRate =
            (eventDetails.verifiedAttendeesCount * 100) /
            eventDetails.userRegCount;
        canRelease = attendanceRate >= MINIMUM_ATTENDANCE_RATE;

        return (canRelease, attendanceRate, revenue);
    }

    // Function for owner to check events requiring manual release
    function getEventsRequiringManualRelease(
        uint256[] calldata _eventIds
    )
        external
        view
        returns (
            uint256[] memory eventIds,
            uint256[] memory attendanceRates,
            uint256[] memory revenues
        )
    {
        uint256 count = 0;

        // First pass to count eligible events
        for (uint256 i = 0; i < _eventIds.length; i++) {
            uint256 eventId = _eventIds[i];
            Types.EventDetails storage eventDetails = events[eventId];

            if (
                block.timestamp > eventDetails.endDate &&
                !revenueReleased[eventId] &&
                organiserRevBal[eventDetails.organiser][eventId] > 0
            ) {
                uint256 attendanceRate = (eventDetails.verifiedAttendeesCount *
                    100) / eventDetails.userRegCount;

                if (attendanceRate < MINIMUM_ATTENDANCE_RATE) {
                    count++;
                }
            }
        }

        // Initialize arrays with correct size
        eventIds = new uint256[](count);
        attendanceRates = new uint256[](count);
        revenues = new uint256[](count);

        // Second pass to populate arrays
        uint256 index = 0;
        for (uint256 i = 0; i < _eventIds.length; i++) {
            uint256 eventId = _eventIds[i];
            Types.EventDetails storage eventDetails = events[eventId];

            if (
                block.timestamp > eventDetails.endDate &&
                !revenueReleased[eventId]
            ) {
                uint256 revenue = organiserRevBal[eventDetails.organiser][
                    eventId
                ];
                if (revenue > 0) {
                    uint256 attendanceRate = (eventDetails
                        .verifiedAttendeesCount * 100) /
                        eventDetails.userRegCount;

                    if (attendanceRate < MINIMUM_ATTENDANCE_RATE) {
                        eventIds[index] = eventId;
                        attendanceRates[index] = attendanceRate;
                        revenues[index] = revenue;
                        index++;
                    }
                }
            }
        }
    }
}