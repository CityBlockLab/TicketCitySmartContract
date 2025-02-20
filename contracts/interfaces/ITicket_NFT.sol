// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface ITicket_NFT {
    function safeMint(address to) external;

    function balanceOf(address owner) external view returns (uint256);
}
