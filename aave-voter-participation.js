import fetch from 'node-fetch'

// global scope
const space = 'aave.eth'
const uPennAddress = '0x070341aA5Ed571f0FB2c4a5641409B1A46b4961b'
const snapshotEndpoint = 'https://hub.snapshot.org/graphql'

// global variables - built over the course of the process
let proposals = []
let addressByCount = {} // count -> voter_address[]
let countByAddress = {} // voter_address -> count

// helper method for the network requests
const makeQuery = async (query) => {
  const result = await fetch(snapshotEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ query: query })
  })
  return await result.json()
}

// Fetch all votes from a proposal with pagination handling
const getVotesFromProposal = async (proposal) => {
  const proposalVotes = []

  // recursive helper function for pagination offsetting
  const getVotes = async (offset = 0) => {
    const { data } = await makeQuery(`
      query {
        votes (
          first: 1000,
          skip: ${0 + offset},
          where: {
            proposal: "${proposal.id}"
          },
          orderBy: "created",
          orderDirection: desc
        ) {
          voter
          proposal {
            id
          }
        }
      }`)

    proposalVotes.push(...data.votes)

    if (data.votes.length < 1000) {
      return proposalVotes
    } else {
      return await getVotes(offset + 1000)
    }
  }

  return await getVotes()
}

// takes in a set of votes and updates two data structures,  
// which are held in the global scope: addressByCount and countByAddress
const splitAddressVoteCountMatrix = (votes) => {
  votes.forEach(vote => {
    const voteCount = countByAddress[vote.voter]
    // if seen before
    if (voteCount) {
      //  remove old record from count map
      if (addressByCount[voteCount]) {
        addressByCount[voteCount] = addressByCount[voteCount].filter((voterId) => voterId !== vote.voter)
      }
      // add new record to count map
      if (addressByCount[voteCount + 1]) {
        addressByCount[voteCount + 1] = [ ...addressByCount[voteCount + 1], vote.voter ]
      } else {
        addressByCount[voteCount + 1] = [ vote.voter ]
      }
      countByAddress[vote.voter] = voteCount + 1
    } else {
      // record a 1 for the first time we've seen an address
      if (addressByCount[1]) {
        addressByCount[1] = [ ...addressByCount[1], vote.voter]
      } else {
        addressByCount[1] = [ vote.voter ]
      }
      countByAddress[vote.voter] = 1
    }
  })
}

// throttle and log the process of downloading and sorting the votes into data structures
const processVoterParticipation = async (index, proposal) => {
  console.log(`Processing... ${index + 1}/${proposals.length}`)
  try {
    const votesFromProposal = await getVotesFromProposal(proposal)
    splitAddressVoteCountMatrix(votesFromProposal)
  } catch (e) {
    setTimeout(async () => {
      await processVoterParticipation(index, proposal)
    }, 11000)
  }
}

// Fetch all the proposals from Aave (or any other space)
// - inserts into a global variable: proposals
const etlVotingDataFromSpace = async () => {
  const { data } = await makeQuery(`
    query {
      proposals (
        first: 1000,
        skip: 0,
        where: {
          space: "${space}",
          state: "closed"
        },
        orderBy: "created",
        orderDirection: desc
      ) {
        id
      }
    }`)
  proposals = data.proposals
  console.log('Proposals:', proposals.length)

  // Then, extract voter numbers from all the proposal data
  for (let index = 0; index < proposals.length; index++) {
    await processVoterParticipation(index, proposals[index])
  }
}

// Answer Question 1
const getTop20Voters = async () => {
  let top20Voters = []

  // helper variables to get the answer to the question
  const leaderboard = Object.keys(addressByCount).sort((a, b) => b - a).filter(list => list.length > 0)
  let leaderboardIndex = 0

  // get the top 20 addresses, starting from the list of addresses who voted the most
  while (top20Voters.length < 20) {
    const voteCountOfTopVoters = leaderboard[leaderboardIndex]
    // if all of the voters who voted this # of times is < 20, add them
    if (top20Voters.length + addressByCount[voteCountOfTopVoters].length <= 20) {
      top20Voters = [ ...top20Voters, ...addressByCount[voteCountOfTopVoters]]
      leaderboardIndex++
    } else {
      // only take as many as will add up to 20
      const remainingAmount = 20 - top20Voters.length
      top20Voters = [ ...top20Voters, ...addressByCount[voteCountOfTopVoters].splice(0, remainingAmount)]
    }
  }

  // add voting rates and sort by highest
  top20Voters = top20Voters
      .map(address => ({
        address,
        voteCount: countByAddress[address],
        votingRate: countByAddress[address] / proposals.length,
      }))
      .sort((a,b) => b.votingRate - a.votingRate)
      .map(({ address, votingRate, voteCount }, index) => ({
        rank: index + 1, address, votingRate, voteCount
      }))

  console.log({ top20Voters })
}

// Answer Question 2
const getVotingRateFromAddress = async (address) => {
  const votingRate = countByAddress[address] / proposals.length
  console.log('UPenn Voting:', {
    address,
    votingRate,
    voteCount: countByAddress[address]
  })
  return votingRate
}

/**
 * Start
 */ 
const start = async () => {
  // First, load all the voting data from Aave
  await etlVotingDataFromSpace()

  // Ask Question 1
  await getTop20Voters()

  // Ask Question 2
  await getVotingRateFromAddress(uPennAddress)
}

// starts here
start()
