// Smart Contract Configurations for Unice Prediction Market

export const CHAIN_ID = 421614; // Arbitrum Sepolia
export const CHAIN_HEX = "0x66eee";
export const CHAIN_NAME = "Arbitrum Sepolia";
export const RPC_URL = "https://sepolia-rollup.arbitrum.io/rpc";
export const BLOCK_EXPLORER = "https://sepolia.arbiscan.io";

export const MOCK_USDC_ADDRESS = "0xb404587C0454C12309DD518b4900F8D0dc916118";
export const UNICE_FACTORY_ADDRESS = "0xD66E625d40929123065ee95Bb67fFe08CCf8cFD1";

export const MOCK_USDC_ABI = [
  // Read-only functions
  "function balanceOf(address owner) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function name() external view returns (string)",
  "function symbol() external view returns (string)",
  
  // State-changing functions
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function mint(address to, uint256 amount) external",
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) external returns (bool)",
  
  // Events
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "event Approval(address indexed owner, address indexed spender, uint256 value)"
];

export const UNICE_FACTORY_ABI = [
  // Read-only functions
  "function admin() external view returns (address)",
  "function collateralToken() external view returns (address)",
  "function allMarkets(uint256 index) external view returns (address)",
  "function getAllMarkets() external view returns (address[])",
  "function getMarketsByCategory(string category) external view returns (address[])",
  "function getTotalMarkets() external view returns (uint256)",
  "function isMarket(address market) external view returns (bool)",
  
  // State-changing functions
  "function createMarket(string question, string category, uint256 bettingDeadline, uint256 resolutionDeadline) external returns (address)",
  
  // Events
  "event MarketCreated(address indexed market, string question, string category, uint256 bettingDeadline, uint256 resolutionDeadline)"
];

export const UNICE_PREDICTION_MARKET_ABI = [
  // Read-only functions
  "function question() external view returns (string)",
  "function category() external view returns (string)",
  "function admin() external view returns (address)",
  "function collateralToken() external view returns (address)",
  "function bettingDeadline() external view returns (uint256)",
  "function resolutionDeadline() external view returns (uint256)",
  "function outcome() external view returns (uint8)",
  "function submittedAt() external view returns (uint256)",
  "function challenged() external view returns (bool)",
  "function finalized() external view returns (bool)",
  "function totalYesPool() external view returns (uint256)",
  "function totalNoPool() external view returns (uint256)",
  "function yesShares(address user) external view returns (uint256)",
  "function noShares(address user) external view returns (uint256)",
  "function claimed(address user) external view returns (bool)",
  "function getOdds() external view returns (uint256 yesPct, uint256 noPct)",
  "function getStatus() external view returns (string)",
  "function getClaimable(address user) external view returns (uint256)",
  "function getMarketInfo() external view returns (string _question, string _category, uint256 _bettingDeadline, uint256 _resolutionDeadline, uint256 _totalYesPool, uint256 _totalNoPool, uint8 _outcome, bool _finalized)",
  
  // State-changing functions
  "function bet(bool isYes, uint256 amount) external",
  "function submitResult(uint8 _outcome) external",
  "function challenge() external",
  "function finalize() external",
  "function claim() external",
  "function expireClaim() external",
  
  // Events
  "event BetPlaced(address indexed user, bool isYes, uint256 amount)",
  "event ResultSubmitted(uint8 outcome, uint256 timestamp)",
  "event ResultChallenged(address indexed challenger)",
  "event MarketFinalized(uint8 outcome)",
  "event WinningsClaimed(address indexed user, uint256 amount)",
  "event ExpireRefundClaimed(address indexed user, uint256 amount)"
];

// Fallback pre-seeded markets in case RPC calls fail to retrieve them dynamically
export const PRESEEDED_MARKETS = [
  "0x56903DbEbB61f3dd5A193FfF83e5b040815FFAC3",
  "0xE7A119Ec3A03cE80FA45F0cd7a02818290d25561",
  "0xD6f4AE84d063152e9D7ca6400aDEc590897D9f23",
  "0xcBCd464905f195900867B67DE94c63f42b413C06",
  "0xdb07cC66449551CAD621a91C5E2D558AEAA69621",
  "0x9E083ada1e300581055AECC65861CBf047ec06a5",
  "0xF1158f993b8f52618059861FcB563cDF95bF8518",
  "0xBE67bdFd441933dd5373E53d68e28c4cABF14245",
  "0xd8dBc7CCF432163568ad50f35BBb6E42d038855A"
];
