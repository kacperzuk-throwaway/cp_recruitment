// SPDX-License-Identifier: MIT
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/utils/Counters.sol";
import "hardhat/console.sol";

contract Lottery {
  using Counters for Counters.Counter;

  uint256 public immutable ticketPrice = 0.2 ether;
  uint256 public immutable winChanceDivisor = 10; // 1/10 = 10% chance of winning

  event TicketBought(address indexed owner, uint256 indexed ticketId);
  event Won(address indexed owner, uint256 indexed ticketId, uint256 prize);
  event Lost(address indexed owner, uint256 indexed ticketId);

  // tickets are only valid for ~255 blocks due to limitations in fetching old block hashes
  event Expired(address indexed owner, uint256 indexed ticketId);

  // Mapping from tickets to their owners
  mapping(uint256 => address) private _owners;

  // Mapping from tickets to block numbers they're minted on
  // Used to select block hashes for deciding whether it's a winning ticket or not
  mapping(uint256 => uint256) private _blocks;

  // In this contract, withdrawing a prize results in burning all tickets that were minted before the one being processed. We keep track of winnings for all winning tickets that were burned, so that prizes can be withdrawn out-of-order of buying tickets.
  mapping(address => uint256) public winnings;

  // Used for incrementing ticket Ids
  Counters.Counter private _tokenIdCounter;

  // All older than this were already burned and processed
  uint256 public firstValidTicket = 0;

  modifier requiresValidTicket(uint256 ticketId) {
    require(ticketId >= firstValidTicket, "This ticket was already burned.");
    require(ticketId < _tokenIdCounter.current(), "This ticket doesn't exist.");
    _;
  }

  // Buying ticket. Returns ticketID that should be used to check/claim prize.
  function buyTicket(address to) public payable {
    require(msg.value == ticketPrice, "Invalid amount paid for ticket.");

    uint256 ticketId = _tokenIdCounter.current();
    _tokenIdCounter.increment();
    _owners[ticketId] = to;
    _blocks[ticketId] = block.number;
    emit TicketBought(to, ticketId);
  }

  function checkIfWinning(uint256 ticketId) public view requiresValidTicket(ticketId) returns (bool) {
    require(isOldEnough(ticketId), "Not ready yet, check again later!");

    uint256 mintedBlockNumber = _blocks[ticketId];
    require(!isExpired(ticketId), "Ticket expired!");

    uint256 randomNumber = uint256(
      keccak256(
        abi.encodePacked(
          blockhash(mintedBlockNumber), '-',
          blockhash(mintedBlockNumber + 1), '-',
          blockhash(mintedBlockNumber + 2), '-',
          ticketId
        )
      ));
    bool res = randomNumber < type(uint256).max/winChanceDivisor;
    return res;
  }

  // used internally to cleanup ticket after it's been processed
  function _burn(uint256 ticketId) private requiresValidTicket(ticketId) {
    require(ticketId == firstValidTicket, "Only the first unprocessed ticket can be burned!");
    firstValidTicket += 1;
    delete _blocks[ticketId];
    delete _owners[ticketId];
  }

  // used to check if 3 blocks since minting required for randomness have passed
  function isOldEnough(uint256 ticketId) public view requiresValidTicket(ticketId) returns (bool) {
    uint256 mintedBlockNumber = _blocks[ticketId];
    return mintedBlockNumber + 2 < block.number;
  }

  function isExpired(uint256 ticketId) public view requiresValidTicket(ticketId) returns (bool) {
    uint256 mintedBlockNumber = _blocks[ticketId];
    return mintedBlockNumber + 256 < block.number;
  }

  // potentially gas-intensive - see README.md
  // check all tickets from firstValidTicket up to specified maxTicketId
  // * if maxTicketId is bigger than max minted ticket, we'll process all unprocessed tickets
  // * won't fail on tickets older than firstValidTicket, it just won't do anything
  function processTicketsUpTo(uint256 maxTicketId) private {
    if(maxTicketId >= _tokenIdCounter.current()) {
      maxTicketId = _tokenIdCounter.current() - 1;
    }
    uint256 prize = 0;
    while(firstValidTicket <= maxTicketId && isOldEnough(firstValidTicket)) {
      address owner = _owners[firstValidTicket];
      prize += ticketPrice;
      if(isExpired(firstValidTicket)) {
        emit Expired(owner, firstValidTicket);
      } else if (checkIfWinning(firstValidTicket)) {
        emit Won(owner, firstValidTicket, prize);
        winnings[owner] += prize;
        prize = 0;
      } else {
        emit Lost(owner, firstValidTicket);
      }

      _burn(firstValidTicket); // increments firstValidTicket
    }
  }

  // first process tickets up to a point to calculate potential prices, then
  // withdraw (if there is something to withdraw)
  // we follow Checks-Effects-Interactions pattern + use a reentrancy guard
  function withdrawPrize(address payable to, uint256 maxTicketId) public {
    processTicketsUpTo(maxTicketId);
    uint256 winning = winnings[to];

    // we use if here to revert what we've calculated in processTicketsUpTo, as
    // that would be wasteful
    if (winning > 0) {
      winnings[to] = 0;
      (bool sent, ) = to.call{value: winning}("");
      require(sent, "Failed to send Ether");
    }
  }
}
