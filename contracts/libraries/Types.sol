// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

library Types {
    enum TicketType {
        FREE,
        PAID
    }

    enum PaidTicketCategory {
        NONE,
        REGULAR,
        VIP
    }

    struct EventDetails {
        string title;
        string desc;
        string imageUri;
        string location;
        uint256 startDate;
        uint256 endDate;
        uint256 expectedAttendees;
        TicketType ticketType;
        PaidTicketCategory paidTicketCategory;
        uint32 userRegCount;
        uint32 verifiedAttendeesCount;
        uint256 ticketFee;
        address ticketNFTAddr;
        address organiser;
    }

    struct TicketTypes {
        bool hasRegularTicket;
        bool hasVIPTicket;
        uint256 regularTicketFee;
        uint256 vipTicketFee;
        address regularTicketNFT;
        address vipTicketNFT;
    }
}
