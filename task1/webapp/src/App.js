import { useState, useEffect } from "react"
import { ethers, BigNumber } from "ethers"
import Lottery from "./contracts/Lottery.json"
import config from "./config.json"


function getContract(signer) {
  return new ethers.Contract(
      config.lotteryContractAddress,
      Lottery.abi,
      signer
    );
}

function App() {
  const [provider, setProvider] = useState(null)
  const [signer, setSigner] = useState(null)
  const [address, setAddress] = useState(null)
  const [ticketPrice, setTicketPrice] = useState(null)
  const [blockNumber, setBlockNumber] = useState(null)
  const [winning, setWinning] = useState(null)
  const [tickets, setTickets] = useState(null)
  const [txInProgress, setTxInProgress] = useState(false)

  function reset() {
    if(window.ethereum)
      window.ethereum.removeAllListeners()
    if(provider)
      provider.removeAllListeners()
    setTxInProgress(false)
    setWinning(null)
    setTickets(null)
    setBlockNumber(null)
    setTicketPrice(null)
    setSigner(null)
    setProvider(null)
  }

  async function handleNewBlock(number) {
    if(!signer) throw new Error("Coding error, signer should be present here!")

    const contract = getContract(signer)
    setBlockNumber(number)

    const _winning = await contract.winnings(address)
    setWinning(_winning)

    const filter = contract.filters.TicketBought(address)
    const _tickets = await contract.queryFilter(filter)
    const firstValidTicket = await contract.firstValidTicket()
    const pendingTickets = _tickets.map(t => t.args.ticketId).filter(id => id.gte(firstValidTicket))
    const _ticketsWithState = await Promise.all(pendingTickets.map(async (t) => {
      const isOldEnough = await contract.isOldEnough(t)
      const isExpired = await contract.isExpired(t)
      const isWinning = isOldEnough && !isExpired ? await contract.checkIfWinning(t) : null
      return { isWinning, isOldEnough, isExpired, id: t }
    }))
    setTickets(_ticketsWithState)
  }

  async function buyTicket() {
    if(!signer) throw new Error("Coding error, signer should be present here!")
    if(!address) throw new Error("Coding error, address should be present here!")
    if(!ticketPrice) throw new Error("Coding error, ticketPrice should be present here!")

    setTxInProgress(true)
    const contract = getContract(signer)

    try {
      const tx = await contract.buyTicket(address, { value: ticketPrice })
      await tx.wait()
    } catch(e) {
      console.log(e)
    }

    setTxInProgress(false)
    return
  }

  async function withdraw() {
    if(!signer) throw new Error("Coding error, signer should be present here!")
    if(!address) throw new Error("Coding error, address should be present here!")
    if(!tickets) throw new Error("Tickets should be available!")

    setTxInProgress(true)
    const contract = getContract(signer)

    const winningTickets = tickets.filter(t => t.isWinning)
    const maxTicketId = winningTickets.reduce((max, t) => (max.gt(t.id) ? max : t.id), BigNumber.from(0))

    try {
      const tx = await contract.withdrawPrize(address, maxTicketId)
      await tx.wait()
    } catch(e) {
      console.log(e)
    }

    setTxInProgress(false)
    return
  }

  useEffect(() => {
    (async () => {
      if(!window.ethereum) {
        return
      } else if(!provider) {
        const _provider = new ethers.providers.Web3Provider(window.ethereum)
        setProvider(_provider)
      } else if(!signer) {
        const [_address] = await provider.send("eth_requestAccounts", [])
        const _signer = provider.getSigner()
        setAddress(_address)
        setSigner(_signer)
        window.ethereum.once("accountsChanged", reset)
        window.ethereum.once("chainChanged", reset)
      } else if(!blockNumber) {
        provider.on("block", handleNewBlock)
        const _blockNumber = await provider.getBlockNumber()
        handleNewBlock(_blockNumber)
      } else if (!ticketPrice) {
        const contract = getContract(signer)
        setTicketPrice(await contract.ticketPrice())
      }
    })();
  })

  if (window.ethereum === undefined) {
      return <div>No wallet detected! Install metamask or smth.</div>
  }

  if(!signer) {
    return <div>Please connect your wallet.</div>
  }

  if(window.ethereum.networkVersion !== config.chainId.toString()) {
    return <div>Invalid network, please connect your wallet to hardhat node on Localhost:8545</div>
  }

  if(!ticketPrice || !blockNumber || winning === null || tickets === null) {
    return <div>Please wait, loading data...</div>
  }

  const winningTickets = tickets.filter(t => t.isWinning)
  return <div>
    <p>Data:</p>
    <ul>
      <li>Your address: {address}</li>
      <li>Block number: {blockNumber}</li>
      <li>ChainID: {config.chainId}</li>
      <li>Lottery contract addr: {config.lotteryContractAddress}</li>
      <li>Lottery ticket price: {ethers.utils.formatEther(ticketPrice)} ETH</li>
    </ul>
    <p>Your current tickets: {tickets.length === 0 ? "no tickets!" : null}</p>
    <ul>
      {tickets.map(ticket =>
        <li key={ticket.id.toString()}>Ticket #{ticket.id.toString()} {ticket.isExpired ? "(EXPIRED!)" : !ticket.isOldEnough ? "(Not ready yet, wait a few blocks)" : ticket.isWinning ? "(Winning! Click withdraw to get your prize!)" : "(Lost :/)"}</li>
      )}
    </ul>
    <p>Your pending winnings from tickets processed by others: {ethers.utils.formatEther(winning)} ETH</p>
    {txInProgress ? <p>Transaction in progress, please wait...</p> : null}
    <button disabled={txInProgress} onClick={buyTicket}>Buy ticket!</button>
    <button disabled={txInProgress || (winning.lte(0) && winningTickets.length === 0)} onClick={withdraw}>Withdraw winnings!</button>
  </div>
}

export default App
