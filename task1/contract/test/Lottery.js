const { expect } = require("chai");

async function mine(network, n) {
  for (let i = 0; i < n; i++)
    await network.provider.send("evm_mine")
}

describe("Lottery contract", function () {
  let Lottery;
  let hardhatLottery;
  let addrs;
  const ticketPrice = ethers.utils.parseEther("0.2");

  beforeEach(async function() {
    await network.provider.send("evm_setAutomine", [true]);
    await network.provider.send("evm_mine");

    addrs = await ethers.getSigners();
    Lottery = await ethers.getContractFactory("Lottery");
    hardhatLottery = await Lottery.deploy();
  });

  describe("Buy ticket", async function () {
    it("Shouldn't sell tickets cheaply", async function() {
      const addr = addrs[0].address;
      const val = ethers.utils.parseEther("0.1");
      await expect(hardhatLottery.buyTicket(addr, {value: val}))
        .to.be.revertedWith("Invalid amount paid for ticket.");
    });

    it("Shouldn't sell tickets for too much", async function() {
      const addr = addrs[0].address;
      const val = ethers.utils.parseEther("1.0");
      await expect(hardhatLottery.buyTicket(addr, {value: val}))
        .to.be.revertedWith("Invalid amount paid for ticket.");
    });

    it("Should sell tickets for correct price and emit correct signal", async function() {
      const addr = addrs[0].address;
      await expect(hardhatLottery.buyTicket(addr, {value: ticketPrice}))
        .to.emit(hardhatLottery, "TicketBought")
        .withArgs(addr, 0);
    });

    it("Should increment ticket Ids", async function() {
      const addr1 = addrs[0].address;
      const addr2 = addrs[2].address;
      await expect(hardhatLottery.buyTicket(addr1, {value: ticketPrice}))
        .to.emit(hardhatLottery, "TicketBought")
        .withArgs(addr1, 0);
      await expect(hardhatLottery.buyTicket(addr1, {value: ticketPrice}))
        .to.emit(hardhatLottery, "TicketBought")
        .withArgs(addr1, 1);
      await expect(hardhatLottery.buyTicket(addr2, {value: ticketPrice}))
        .to.emit(hardhatLottery, "TicketBought")
        .withArgs(addr2, 2);
    });
  });

  it("isExpired properly detects expired", async function() {
    await network.provider.send("evm_setAutomine", [false]);
    const tx = await hardhatLottery.buyTicket(addrs[0].address, {value: ticketPrice});
    await mine(network, 1);
    expect(await hardhatLottery.isExpired(0)).to.be.false;
    await mine(network, 256);
    expect(await hardhatLottery.isExpired(0)).to.be.false;
    await mine(network, 1);
    expect(await hardhatLottery.isExpired(0)).to.be.true;
  });

  it("isOldEnough properly waits 3 blocks", async function() {
    await network.provider.send("evm_setAutomine", [false]);
    const tx = await hardhatLottery.buyTicket(addrs[0].address, {value: ticketPrice});
    await mine(network, 1);
    expect(await hardhatLottery.isOldEnough(0)).to.be.false;
    await mine(network, 1);
    expect(await hardhatLottery.isOldEnough(0)).to.be.false;
    await mine(network, 1);
    expect(await hardhatLottery.isOldEnough(0)).to.be.false;
    await mine(network, 1);
    expect(await hardhatLottery.isOldEnough(0)).to.be.true;
  });

  it("checkIfWinning properly waits 3 blocks", async function() {
    await network.provider.send("evm_setAutomine", [false]);
    const tx = await hardhatLottery.buyTicket(addrs[0].address, {value: ticketPrice});
    await mine(network, 1);
    await expect(hardhatLottery.checkIfWinning(0)).to.be.revertedWith("Not ready yet, check again later!");
    await mine(network, 1);
    await expect(hardhatLottery.checkIfWinning(0)).to.be.revertedWith("Not ready yet, check again later!");
    await mine(network, 1);
    await expect(hardhatLottery.checkIfWinning(0)).to.be.revertedWith("Not ready yet, check again later!");
    await mine(network, 1);
    await hardhatLottery.checkIfWinning(0);
    await expect(hardhatLottery.checkIfWinning(0)).to.not.be.reverted;
  });

  describe("checkIfWinning", async function() {
    it("detects expired tickets", async function() {
      await network.provider.send("evm_setAutomine", [false]);
      const tx = await hardhatLottery.buyTicket(addrs[0].address, {value: ticketPrice});
      await mine(network, 4);
      await expect(hardhatLottery.checkIfWinning(0)).to.not.be.reverted;
      await mine(network, 253);
      await expect(hardhatLottery.checkIfWinning(0)).to.not.be.reverted;
      await mine(network, 1);
      await expect(hardhatLottery.checkIfWinning(0)).to.be.revertedWith("Ticket expired!");
    });

    // hard to test undeterministic stuff :/
    it("wins ~10% of tickets", async function() {
      const n = 400;
      let lastChecked = -1;
      let wins = 0;
      for(let i = 0; i < n; i++) {
        await hardhatLottery.buyTicket(addrs[0].address, {value: ticketPrice});
        if(i >= 3) {
          const checkId = i - 3;
          wins += await hardhatLottery.checkIfWinning(checkId)
          lastChecked = checkId;
        }
      }

      await mine(network, 3);
      for(let i = lastChecked+1; i < n; i++) {
        wins += await hardhatLottery.checkIfWinning(i);
      }
      // wide margin to reduce false-positives
      expect(wins).to.be.within(0.05*n, 0.15*n);
    });
  });

  describe("withdrawPrize", async function() {
    it("Reward is equal to (1+number of lost tickets since last win) * ticketPrice - 2 separate withdrawals", async function() {
      let win = false;
      firstWinTicketId = -1;
      while(!win) {
        firstWinTicketId += 1;
        await hardhatLottery.buyTicket(addrs[0].address, {value: ticketPrice});
        await mine(network, 3);
        win = await hardhatLottery.checkIfWinning(firstWinTicketId);
      }

      let provider = waffle.provider;

      let balanceBefore = await provider.getBalance(addrs[0].address);
      let tx = await hardhatLottery.withdrawPrize(addrs[0].address, firstWinTicketId);
      let receipt = await tx.wait();
      let balanceAfter = await provider.getBalance(addrs[0].address);
      let winning = balanceAfter.sub(balanceBefore).add(receipt.cumulativeGasUsed.mul(receipt.effectiveGasPrice));
      // +1 as tokens start at 0
      expect(winning).to.be.equal(ticketPrice.mul(1+firstWinTicketId));

      win = false;
      secondWinTicketId = firstWinTicketId;
      while(!win) {
        secondWinTicketId += 1;
        await hardhatLottery.buyTicket(addrs[0].address, {value: ticketPrice});
        await mine(network, 3);
        win = await hardhatLottery.checkIfWinning(secondWinTicketId);
      }

      balanceBefore = await provider.getBalance(addrs[0].address);
      tx = await hardhatLottery.withdrawPrize(addrs[0].address, secondWinTicketId);
      receipt = await tx.wait();
      balanceAfter = await provider.getBalance(addrs[0].address);
      winning = balanceAfter.sub(balanceBefore).add(receipt.cumulativeGasUsed.mul(receipt.effectiveGasPrice));
      expect(winning).to.be.equal(ticketPrice.mul(secondWinTicketId - firstWinTicketId));
    });

    it("Reward is equal to (1+number of lost tickets since last win) * ticketPrice - 1 withdrawal for 2 wins", async function() {
      let wins = 0;
      winTicketId = -1;
      while(wins < 2) {
        winTicketId += 1;
        await hardhatLottery.buyTicket(addrs[0].address, {value: ticketPrice});
        await mine(network, 3);
        wins += await hardhatLottery.checkIfWinning(winTicketId);
      }

      let provider = waffle.provider;

      balanceBefore = await provider.getBalance(addrs[0].address);
      tx = await hardhatLottery.withdrawPrize(addrs[0].address, winTicketId);
      receipt = await tx.wait();
      balanceAfter = await provider.getBalance(addrs[0].address);
      winning = balanceAfter.sub(balanceBefore).add(receipt.cumulativeGasUsed.mul(receipt.effectiveGasPrice));
      expect(winning).to.be.equal(ticketPrice.mul(winTicketId +1));
    });

    it("We properly expire old tickets", async function() {
      await hardhatLottery.buyTicket(addrs[0].address, {value: ticketPrice});
      await mine(network, 257);
      const tx = await hardhatLottery.withdrawPrize(addrs[0].address, 0);
      const receipt = await tx.wait();
      const expired_events = receipt.events.filter((e) => e.event == "Expired")
      expect(expired_events).to.not.be.empty;
    });
  });


});
