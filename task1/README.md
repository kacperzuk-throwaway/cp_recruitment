# Task1
## Usage:

```
cd contract
npm install
npx hardhat compile
npx hardhat test
npx hardhat node # take note of one of the accounts and import it into your metamask
npx hardhat run scripts/deploy.js --network localhost | tee ../webapp/src/config.json

cd ../webapp
npm install
npm start # web browser should open, if not - visit http://localhost:3000
```

## Notes

Main challenge of this task is to have a secure way of obtaining randomness. For production use, if forced to implement a contract based on randomness, I'd go for [Chainlink VRF](https://docs.chain.link/docs/chainlink-vrf/). However, this is a bit of a hassle to implement just for recruitment task, so I've decided to use less secure way of obtaining randomness from hashes of "future" blocks.

To do that, some data needs to be stored between blocks. This is done with "Tickets". Users buy a ticket in block N, get a ticket ID, and in block N+3 can check if the ticket is a winning ticket and withdraw a prize.

## Limitations

* In Ethereum we can only access block hashes of last 256 blocks. This means that tickets are only valid for ~253 blocks. Any potential prize will be lost after that if it's not withdrawn in time.

## Assumptions

* Task specification says that the reward for winning is "whole prize pool at a given moment". Given that - due to randomness issues - we had to split the lottery into separate "buy ticket" and "claim prize", there's a question which moment we should use when calculating the prize. Usually that should be cleared up with a client, but here I've assumed that we want to be "fair" and payout everything collected since last winning ticket sold. That however requires processing all previous unprocessed tickets when withdrawing a prize, which could be gas expensive and can potentially total gas can be higher than potential reward.

## Randomness risks

Block hash is mostly unpredictable, but could be influenced by a miner. For example, miner could try brute-force a winning number by changing the block nonce (which affects the hash). We try to mitigate this by using 3 consecutive block hashes. By trying to brute-force block hash in a way that gives him a winning ticket, miner effectively increases their mining difficulty - making it less likely they'll mine a block - which results in potential loss of block reward. So as long as lottery prize isn't competitive with block reward, this should be "good enough".

## References

Materials I've used:
* https://blog.openzeppelin.com/reentrancy-after-istanbul/
* https://solidity-by-example.org/
* https://docs.soliditylang.org/en/v0.8.9/
* https://hardhat.org/getting-started/
* https://docs.openzeppelin.com/contracts/4.x/
