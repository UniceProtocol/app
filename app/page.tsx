"use client";

declare global {
  interface Window {
    ethereum?: any;
  }
}

import React, { useState, useEffect, useCallback, useRef } from "react";
import { ethers } from "ethers";
import {
  Trophy,
  Coins,
  Wallet,
  Search,
  Plus,
  Vote,
  Clock,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  Activity,
  X,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  ShieldAlert,
  ArrowRight,
  RefreshCw,
  Percent,
  ListFilter
} from "lucide-react";

import {
  CHAIN_ID,
  CHAIN_HEX,
  CHAIN_NAME,
  RPC_URL,
  BLOCK_EXPLORER,
  MOCK_USDC_ADDRESS,
  UNICE_FACTORY_ADDRESS,
  MOCK_USDC_ABI,
  UNICE_FACTORY_ABI,
  UNICE_PREDICTION_MARKET_ABI,
  PRESEEDED_MARKETS
} from "./utils/contracts";

interface Market {
  address: string;
  question: string;
  category: string;
  bettingDeadline: number;
  resolutionDeadline: number;
  totalYesPool: string;
  totalNoPool: string;
  outcome: number; // 0=Unresolved, 1=Yes, 2=No, 3=Invalid
  finalized: boolean;
  status: string; // "OPEN", "CLOSED", "PENDING", "FINALIZED", "EXPIRED"
  yesOdds: number; // percentage (e.g. 50)
  noOdds: number; // percentage (e.g. 50)
  challenged: boolean;
  submittedAt: number;
  userYesShares: string;
  userNoShares: string;
  userClaimed: boolean;
  claimable: string;
}

export default function Dashboard() {
  // Web3 States
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [account, setAccount] = useState<string>("");
  const [factoryAdmin, setFactoryAdmin] = useState<string>("");
  const [usdcBalance, setUsdcBalance] = useState<string>("0.00");
  const [networkError, setNetworkError] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // Contracts Data States
  const [markets, setMarkets] = useState<Market[]>(MOCK_PREVIEW_MARKETS);
  const [filteredMarkets, setFilteredMarkets] = useState<Market[]>([]);

  // Interaction states
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [expandedMarket, setExpandedMarket] = useState<string | null>(null);

  // Modal states
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [newMarket, setNewMarket] = useState({
    question: "",
    category: "worldcup",
    bettingDeadlineDays: "5",
    resolutionDeadlineDays: "10"
  });

  // Betslip States
  const [betslip, setBetslip] = useState<{
    marketAddress: string;
    question: string;
    isYes: boolean;
    amount: string;
  } | null>(null);

  // Status Alerts/Toasts
  const [alert, setAlert] = useState<{
    type: "success" | "error" | "info" | "warning";
    message: string;
  } | null>(null);

  // Loading indicator states for transactions
  const [txLoading, setTxLoading] = useState<{
    type: "mint" | "bet" | "approve" | "resolve" | "challenge" | "finalize" | "claim" | "create" | null;
    address?: string;
  }>({ type: null });

  // Ref for horizontal scroll in Best Odds section
  const featuredScrollRef = useRef<HTMLDivElement>(null);

  // Function to show self-dismissing alerts
  const triggerAlert = useCallback((type: "success" | "error" | "info" | "warning", message: string) => {
    setAlert({ type, message });
    setTimeout(() => {
      setAlert(null);
    }, 6000);
  }, []);

  // Helper: fetch current gas fees with a safety buffer for Arbitrum Sepolia
  const getGasOverrides = async () => {
    try {
      const rpcProvider = new ethers.JsonRpcProvider(RPC_URL);
      const feeData = await rpcProvider.getFeeData();
      const baseFee = feeData.maxFeePerGas ?? BigInt(100000000);
      const priority = feeData.maxPriorityFeePerGas ?? BigInt(1500000000);
      return {
        maxFeePerGas: (baseFee * BigInt(150)) / BigInt(100),        // +50% buffer
        maxPriorityFeePerGas: (priority * BigInt(150)) / BigInt(100) // +50% buffer
      };
    } catch {
      return {}; // fallback to provider defaults
    }
  };

  // Indexer API URL
  const INDEXER_API_URL = process.env.NEXT_PUBLIC_INDEXER_API || "http://localhost:8080";

  // Initialize data — tries indexer API first, falls back to direct RPC
  const loadMarketsData = useCallback(async (userAddress?: string) => {
    try {
      // --- Attempt 1: Fetch base market data from Indexer API ---
      let apiMarkets: Market[] | null = null;
      try {
        const res = await fetch(`${INDEXER_API_URL}/api/markets`, {
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const json = await res.json();
          if (json.success && Array.isArray(json.data) && json.data.length > 0) {
            apiMarkets = json.data.map((m: any) => {
              // Convert wei pool amounts to human-readable
              const yesPoolWei = BigInt(m.total_yes_pool || "0");
              const noPoolWei = BigInt(m.total_no_pool || "0");
              return {
                address: m.address,
                question: m.question,
                category: m.category,
                bettingDeadline: Number(m.betting_deadline),
                resolutionDeadline: Number(m.resolution_deadline),
                totalYesPool: ethers.formatUnits(yesPoolWei, 18),
                totalNoPool: ethers.formatUnits(noPoolWei, 18),
                outcome: m.outcome,
                finalized: m.status === "FINALIZED",
                status: m.status,
                yesOdds: m.yes_odds,
                noOdds: m.no_odds,
                challenged: false,
                submittedAt: 0,
                userYesShares: "0.00",
                userNoShares: "0.00",
                userClaimed: false,
                claimable: "0.00",
              };
            });
            console.log(`[Unice] Loaded ${apiMarkets!.length} markets from indexer API`);
          }
        }
      } catch (apiErr) {
        console.warn("[Unice] Indexer API unavailable, falling back to RPC:", apiErr);
      }

      // --- Enrich with on-chain data (challenged, submittedAt, user-specific) ---
      if (apiMarkets && apiMarkets.length > 0) {
        const rpcProvider = new ethers.JsonRpcProvider(RPC_URL);
        const enriched = await Promise.all(
          apiMarkets.map(async (market) => {
            try {
              const marketContract = new ethers.Contract(market.address, UNICE_PREDICTION_MARKET_ABI, rpcProvider);

              // Fetch on-chain fields not tracked by indexer
              const [challenged, submittedAt, odds] = await Promise.all([
                marketContract.challenged(),
                marketContract.submittedAt(),
                marketContract.getOdds(),
              ]);
              market.challenged = challenged;
              market.submittedAt = Number(submittedAt);
              market.yesOdds = Number(odds[0]) / 100;
              market.noOdds = Number(odds[1]) / 100;

              // Fetch user-specific data if wallet is connected
              if (userAddress) {
                const [yesShares, noShares, claimed, claimable] = await Promise.all([
                  marketContract.yesShares(userAddress),
                  marketContract.noShares(userAddress),
                  marketContract.claimed(userAddress),
                  marketContract.getClaimable(userAddress),
                ]);
                market.userYesShares = ethers.formatUnits(yesShares, 18);
                market.userNoShares = ethers.formatUnits(noShares, 18);
                market.userClaimed = claimed;
                market.claimable = ethers.formatUnits(claimable, 18);
              }
            } catch (e) {
              console.warn(`[Unice] RPC enrichment failed for ${market.address}:`, e);
            }
            return market;
          })
        );
        setMarkets(enriched);
        return;
      }

      // --- Attempt 2: Full RPC fallback (original logic) ---
      console.log("[Unice] Loading markets via direct RPC...");
      const rpcProvider = new ethers.JsonRpcProvider(RPC_URL);
      const factoryContract = new ethers.Contract(UNICE_FACTORY_ADDRESS, UNICE_FACTORY_ABI, rpcProvider);

      // Fetch Factory Admin
      try {
        const admin = await factoryContract.admin();
        setFactoryAdmin(admin);
      } catch (err) {
        console.error("Error fetching factory admin:", err);
      }

      // Fetch all market addresses
      let marketAddresses: string[] = [];
      try {
        marketAddresses = await factoryContract.getAllMarkets();
      } catch (err) {
        console.warn("Could not load markets from factory contract, falling back to preseeded list:", err);
        marketAddresses = PRESEEDED_MARKETS;
      }

      if (marketAddresses.length === 0) {
        marketAddresses = PRESEEDED_MARKETS;
      }

      // Fetch full details of each market concurrently
      const fetchedMarkets = await Promise.all(
        marketAddresses.map(async (address) => {
          try {
            const marketContract = new ethers.Contract(address, UNICE_PREDICTION_MARKET_ABI, rpcProvider);

            // Call batch getter getMarketInfo
            const info = await marketContract.getMarketInfo();
            const status = await marketContract.getStatus();
            const odds = await marketContract.getOdds();
            const challenged = await marketContract.challenged();
            const submittedAt = await marketContract.submittedAt();

            let userYesShares = "0.00";
            let userNoShares = "0.00";
            let userClaimed = false;
            let claimable = "0.00";

            if (userAddress) {
              userYesShares = ethers.formatUnits(await marketContract.yesShares(userAddress), 18);
              userNoShares = ethers.formatUnits(await marketContract.noShares(userAddress), 18);
              userClaimed = await marketContract.claimed(userAddress);
              claimable = ethers.formatUnits(await marketContract.getClaimable(userAddress), 18);
            }

            const totalYes = info[4];
            const totalNo = info[5];

            // Format pools to human readable numbers
            const formattedYesPool = ethers.formatUnits(totalYes, 18);
            const formattedNoPool = ethers.formatUnits(totalNo, 18);

            return {
              address,
              question: info[0],
              category: info[1],
              bettingDeadline: Number(info[2]),
              resolutionDeadline: Number(info[3]),
              totalYesPool: formattedYesPool,
              totalNoPool: formattedNoPool,
              outcome: Number(info[6]),
              finalized: info[7],
              status,
              yesOdds: Number(odds[0]) / 100, // conversion from basis points
              noOdds: Number(odds[1]) / 100,
              challenged,
              submittedAt: Number(submittedAt),
              userYesShares,
              userNoShares,
              userClaimed,
              claimable
            };
          } catch (e) {
            console.error(`Error loading market at ${address}:`, e);
            return null;
          }
        })
      );

      // Filter out failed loads
      const filtered = fetchedMarkets.filter((m): m is Market => m !== null);
      if (filtered.length === 0) {
        console.warn("Dynamic load returned 0 markets. Loading mock preview data for visual demonstration.");
        setMarkets(MOCK_PREVIEW_MARKETS);
      } else {
        setMarkets(filtered);
      }
    } catch (error) {
      console.error("Error fetching market data:", error);
      triggerAlert("error", "Failed to load prediction markets from the blockchain.");
    } finally {
      setIsLoading(false);
    }
  }, [triggerAlert]);

  // Connect user wallet using MetaMask
  const connectWallet = async () => {
    if (typeof window !== "undefined" && window.ethereum) {
      try {
        const browserProvider = new ethers.BrowserProvider(window.ethereum);
        const network = await browserProvider.getNetwork();

        if (Number(network.chainId) !== CHAIN_ID) {
          setNetworkError(true);
          try {
            await window.ethereum.request({
              method: "wallet_switchEthereumChain",
              params: [{ chainId: CHAIN_HEX }]
            });
            setNetworkError(false);
          } catch (err: any) {
            if (err.code === 4902) {
              await window.ethereum.request({
                method: "wallet_addEthereumChain",
                params: [{
                  chainId: CHAIN_HEX,
                  chainName: CHAIN_NAME,
                  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
                  rpcUrls: [RPC_URL],
                  blockExplorerUrls: [BLOCK_EXPLORER]
                }]
              });
              setNetworkError(false);
            } else {
              triggerAlert("warning", `Please switch your wallet network to ${CHAIN_NAME}`);
              return;
            }
          }
        }

        const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
        const userSigner = await browserProvider.getSigner();

        setProvider(browserProvider);
        setSigner(userSigner);
        setAccount(accounts[0]);
        triggerAlert("success", "Wallet connected!");

        // Fetch Mock USDC balance
        const usdcContract = new ethers.Contract(MOCK_USDC_ADDRESS, MOCK_USDC_ABI, userSigner);
        const rawBalance = await usdcContract.balanceOf(accounts[0]);
        setUsdcBalance(Number(ethers.formatUnits(rawBalance, 18)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

        loadMarketsData(accounts[0]);
      } catch (error) {
        console.error("Wallet connection failed:", error);
        triggerAlert("error", "Wallet connection failed.");
      }
    } else {
      triggerAlert("warning", "MetaMask extension not detected in this browser.");
    }
  };

  // Disconnect wallet
  const disconnectWallet = () => {
    setAccount("");
    setSigner(null);
    setUsdcBalance("0.00");
    triggerAlert("info", "Wallet disconnected.");
    loadMarketsData();
  };

  // Watch account changes inside wallet
  useEffect(() => {
    if (typeof window !== "undefined" && window.ethereum) {
      window.ethereum.on("accountsChanged", (accounts: string[]) => {
        if (accounts.length > 0) {
          setAccount(accounts[0]);
          connectWallet();
        } else {
          disconnectWallet();
        }
      });
      window.ethereum.on("chainChanged", () => {
        window.location.reload();
      });
    }

    // Initial fetch
    connectWallet().catch(() => {
      // Fallback if MetaMask not logged in or present
      loadMarketsData();
    });
  }, []);

  // Filters logic
  useEffect(() => {
    let result = markets;

    // Search Query
    if (searchQuery.trim() !== "") {
      result = result.filter(m => m.question.toLowerCase().includes(searchQuery.toLowerCase()));
    }

    // Category filter
    if (selectedCategory !== "all") {
      result = result.filter(m => m.category === selectedCategory);
    }

    // Status filter
    if (statusFilter !== "all") {
      if (statusFilter === "open") {
        result = result.filter(m => m.status === "OPEN");
      } else if (statusFilter === "challenged") {
        result = result.filter(m => m.challenged);
      } else if (statusFilter === "finalized") {
        result = result.filter(m => m.finalized);
      } else if (statusFilter === "resolved") {
        result = result.filter(m => m.status === "PENDING" && !m.challenged);
      }
    }

    setFilteredMarkets(result);
  }, [markets, selectedCategory, statusFilter, searchQuery]);

  // USDC Minting Faucet
  const handleMintUSDC = async () => {
    if (!signer || !account) {
      triggerAlert("warning", "Please connect your wallet first.");
      return;
    }
    try {
      setTxLoading({ type: "mint" });
      const usdcContract = new ethers.Contract(MOCK_USDC_ADDRESS, MOCK_USDC_ABI, signer);
      const mintAmount = ethers.parseUnits("1000", 18); // Mint 1000 USDC
      const gasOverrides = await getGasOverrides();
      const tx = await usdcContract.mint(account, mintAmount, gasOverrides);
      triggerAlert("info", "Processing USDC minting request...");
      await tx.wait();

      triggerAlert("success", "Successfully minted 1,000 Mock USDC!");

      // Refresh balance
      const rawBalance = await usdcContract.balanceOf(account);
      setUsdcBalance(Number(ethers.formatUnits(rawBalance, 18)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    } catch (e: any) {
      console.error(e);
      triggerAlert("error", `Minting failed: ${e.message || e}`);
    } finally {
      setTxLoading({ type: null });
    }
  };

  // Main Betting Handler
  const handleBet = async () => {
    if (!signer || !account) {
      triggerAlert("warning", "Connect your wallet first.");
      return;
    }
    if (!betslip || parseFloat(betslip.amount) <= 0) {
      triggerAlert("warning", "Please enter a valid betting amount.");
      return;
    }

    const { marketAddress, isYes, amount } = betslip;
    const betAmountRaw = ethers.parseUnits(amount, 18);

    try {
      // 1. Check & Approve USDC
      setTxLoading({ type: "approve", address: marketAddress });
      const usdcContract = new ethers.Contract(MOCK_USDC_ADDRESS, MOCK_USDC_ABI, signer);

      triggerAlert("info", "Verifying USDC spend allowance...");
      const allowance = await usdcContract.allowance(account, marketAddress);

      const gasOverrides = await getGasOverrides();
      if (allowance < betAmountRaw) {
        triggerAlert("info", "Requesting USDC spend approval...");
        const approveTx = await usdcContract.approve(marketAddress, ethers.MaxUint256, gasOverrides);
        await approveTx.wait();
        triggerAlert("success", "USDC approved successfully!");
      }

      // 2. Execute Bet
      setTxLoading({ type: "bet", address: marketAddress });
      const marketContract = new ethers.Contract(marketAddress, UNICE_PREDICTION_MARKET_ABI, signer);

      triggerAlert("info", `Placing bet on ${isYes ? "YES" : "NO"}...`);
      const betTx = await marketContract.bet(isYes, betAmountRaw, gasOverrides);
      await betTx.wait();

      triggerAlert("success", `Successfully placed $${amount} USDC bet!`);
      setBetslip(null);

      // Refresh UI data
      const rawBalance = await usdcContract.balanceOf(account);
      setUsdcBalance(Number(ethers.formatUnits(rawBalance, 18)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
      loadMarketsData(account);
    } catch (e: any) {
      console.error(e);
      triggerAlert("error", `Betting failed: ${e.reason || e.message || e}`);
    } finally {
      setTxLoading({ type: null });
    }
  };

  // Submit Result (Admin action)
  const handleSubmitResult = async (marketAddress: string, outcomeVal: number) => {
    if (!signer) return;
    try {
      setTxLoading({ type: "resolve", address: marketAddress });
      const marketContract = new ethers.Contract(marketAddress, UNICE_PREDICTION_MARKET_ABI, signer);

      triggerAlert("info", `Submitting result as ${outcomeVal === 1 ? "YES" : "NO"}...`);
      const gasOverrides = await getGasOverrides();
      const tx = await marketContract.submitResult(outcomeVal, gasOverrides);
      await tx.wait();

      triggerAlert("success", "Result submitted! Awaiting 30-minute challenge window.");
      loadMarketsData(account);
    } catch (e: any) {
      console.error(e);
      triggerAlert("error", `Failed to submit result: ${e.reason || e.message || e}`);
    } finally {
      setTxLoading({ type: null });
    }
  };

  // Challenge Result (User action)
  const handleChallenge = async (marketAddress: string) => {
    if (!signer) return;
    try {
      setTxLoading({ type: "challenge", address: marketAddress });
      const marketContract = new ethers.Contract(marketAddress, UNICE_PREDICTION_MARKET_ABI, signer);

      triggerAlert("info", "Submitting challenge against result...");
      const gasOverrides = await getGasOverrides();
      const tx = await marketContract.challenge(gasOverrides);
      await tx.wait();

      triggerAlert("success", "Challenge submitted! Market status reset to unresolved.");
      loadMarketsData(account);
    } catch (e: any) {
      console.error(e);
      triggerAlert("error", `Challenge failed: ${e.reason || e.message || e}`);
    } finally {
      setTxLoading({ type: null });
    }
  };

  // Finalize Market (User action)
  const handleFinalize = async (marketAddress: string) => {
    if (!signer) return;
    try {
      setTxLoading({ type: "finalize", address: marketAddress });
      const marketContract = new ethers.Contract(marketAddress, UNICE_PREDICTION_MARKET_ABI, signer);

      triggerAlert("info", "Finalizing prediction market...");
      const gasOverrides = await getGasOverrides();
      const tx = await marketContract.finalize(gasOverrides);
      await tx.wait();

      triggerAlert("success", "Market finalized! Winners can now claim rewards.");
      loadMarketsData(account);
    } catch (e: any) {
      console.error(e);
      triggerAlert("error", `Finalization failed: ${e.reason || e.message || e}`);
    } finally {
      setTxLoading({ type: null });
    }
  };

  // Claim Winnings (User action)
  const handleClaim = async (marketAddress: string) => {
    if (!signer) return;
    try {
      setTxLoading({ type: "claim", address: marketAddress });
      const marketContract = new ethers.Contract(marketAddress, UNICE_PREDICTION_MARKET_ABI, signer);

      triggerAlert("info", "Claiming rewards...");
      const gasOverrides = await getGasOverrides();
      const tx = await marketContract.claim(gasOverrides);
      await tx.wait();

      triggerAlert("success", "Claim successful! USDC tokens transferred to your wallet.");

      // Refresh balance
      const usdcContract = new ethers.Contract(MOCK_USDC_ADDRESS, MOCK_USDC_ABI, signer);
      const rawBalance = await usdcContract.balanceOf(account);
      setUsdcBalance(Number(ethers.formatUnits(rawBalance, 18)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
      loadMarketsData(account);
    } catch (e: any) {
      console.error(e);
      triggerAlert("error", `Claim failed: ${e.reason || e.message || e}`);
    } finally {
      setTxLoading({ type: null });
    }
  };

  // Create Custom Market via Factory
  const handleCreateMarket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signer) {
      triggerAlert("warning", "Connect your wallet first.");
      return;
    }

    try {
      setTxLoading({ type: "create" });
      const factoryContract = new ethers.Contract(UNICE_FACTORY_ADDRESS, UNICE_FACTORY_ABI, signer);

      const nowSecs = Math.floor(Date.now() / 1000);
      const bettingDeadline = nowSecs + (parseInt(newMarket.bettingDeadlineDays) * 24 * 60 * 60);
      const resolutionDeadline = bettingDeadline + (parseInt(newMarket.resolutionDeadlineDays) * 24 * 60 * 60);

      const gasOverrides = await getGasOverrides();
      triggerAlert("info", "Submitting new market creation to factory...");
      const tx = await factoryContract.createMarket(
        newMarket.question,
        newMarket.category,
        bettingDeadline,
        resolutionDeadline,
        gasOverrides
      );
      await tx.wait();

      triggerAlert("success", "New prediction market created successfully!");
      setShowCreateModal(false);
      setNewMarket({
        question: "",
        category: "worldcup",
        bettingDeadlineDays: "5",
        resolutionDeadlineDays: "10"
      });
      loadMarketsData(account);
    } catch (e: any) {
      console.error(e);
      triggerAlert("error", `Failed to create market: ${e.reason || e.message || e}`);
    } finally {
      setTxLoading({ type: null });
    }
  };

  // Helper calculation for betslip winnings estimation
  const getPotentialWinnings = () => {
    if (!betslip || !betslip.amount || parseFloat(betslip.amount) <= 0) return "0.00";
    const amountVal = parseFloat(betslip.amount);
    const activeMarket = markets.find(m => m.address === betslip.marketAddress);
    if (!activeMarket) return "0.00";

    const yesPool = parseFloat(activeMarket.totalYesPool);
    const noPool = parseFloat(activeMarket.totalNoPool);

    if (betslip.isYes) {
      if (noPool === 0) return amountVal.toFixed(2); // no losers, return principal
      const newYesPool = yesPool + amountVal;
      const share = amountVal / newYesPool;
      const payout = amountVal + (share * noPool);
      return payout.toFixed(2);
    } else {
      if (yesPool === 0) return amountVal.toFixed(2); // no losers, return principal
      const newNoPool = noPool + amountVal;
      const share = amountVal / newNoPool;
      const payout = amountVal + (share * yesPool);
      return payout.toFixed(2);
    }
  };

  // Layout helpers for P2Pbet-style center feed
  const getCatLabel = (cat: string): string => {
    const labels: Record<string, string> = { worldcup: "World Cup 2026", politics: "Global Politics", crypto: "Crypto Markets" };
    return labels[cat] || cat;
  };

  const getCatIconElement = (cat: string) => {
    const iconMap: Record<string, React.ReactNode> = {
      worldcup: <Trophy className="w-4 h-4 text-zinc-400" />,
      politics: <Vote className="w-4 h-4 text-zinc-400" />,
      crypto: <Coins className="w-4 h-4 text-zinc-400" />,
    };
    return iconMap[cat] || <Activity className="w-4 h-4 text-zinc-400" />;
  };

  const formatDeadlineShort = (ts: number): string => {
    const now = Math.floor(Date.now() / 1000);
    const diff = ts - now;
    if (diff <= 0) return "Ended";
    if (diff < 86400) return "Today";
    if (diff < 172800) return "Tomorrow";
    return new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const formatPool = (pool: string): string => {
    const num = parseFloat(pool);
    if (num >= 1000) return (num / 1000).toFixed(1) + "k";
    return num.toFixed(2);
  };

  // Featured markets: open markets sorted by highest pool
  const featuredMarkets = filteredMarkets
    .filter((m) => m.status === "OPEN")
    .sort((a, b) => {
      const aPool = parseFloat(a.totalYesPool) + parseFloat(a.totalNoPool);
      const bPool = parseFloat(b.totalYesPool) + parseFloat(b.totalNoPool);
      return bPool - aPool;
    })
    .slice(0, 6);

  // Group filtered markets by category for row-based listing
  const groupedMarkets = filteredMarkets.reduce<Record<string, Market[]>>((acc, m) => {
    if (!acc[m.category]) acc[m.category] = [];
    acc[m.category].push(m);
    return acc;
  }, {});

  return (
    <div className="flex-1 bg-[#09090b] min-h-screen flex flex-col font-sans select-none text-zinc-100 relative">
      {/* Alert Overlay */}
      {alert && (
        <div className="fixed top-4 right-4 z-50">
          <div className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-xl border ${alert.type === "success" ? "bg-zinc-900 border-zinc-700 text-zinc-100" :
              alert.type === "error" ? "bg-rose-950/90 border-rose-500 text-rose-300" :
                alert.type === "warning" ? "bg-amber-950/90 border-amber-500 text-amber-300" :
                  "bg-zinc-900 border-zinc-700 text-zinc-100"
            }`}>
            {alert.type === "success" && <CheckCircle2 className="w-5 h-5 text-zinc-400" />}
            {alert.type === "error" && <AlertTriangle className="w-5 h-5 text-rose-400" />}
            {alert.type === "warning" && <ShieldAlert className="w-5 h-5 text-amber-400" />}
            {alert.type === "info" && <Activity className="w-5 h-5 text-zinc-400" />}
            <span className="text-sm font-semibold">{alert.message}</span>
            <button onClick={() => setAlert(null)} className="hover:opacity-75 cursor-pointer ml-2">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Header Bar */}
      <header className="sticky top-0 z-40 bg-[#09090b]/90 backdrop-blur-md border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-zinc-900 border border-white/10 p-2 rounded-xl flex items-center justify-center w-11 h-11 overflow-hidden">
            <svg viewBox="0 0 398 398" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full text-white fill-current">
              <path d="M168.1 157.136C168.434 160.977 168.852 167.24 169.353 175.924C170.021 184.442 170.522 194.295 170.856 205.485C171.19 216.674 171.274 228.198 171.107 240.055C171.107 251.746 170.689 262.852 169.854 273.374C169.186 283.895 167.933 292.663 166.096 299.677C163.09 311.201 154.74 320.052 141.045 326.232C127.35 332.411 110.149 335.501 89.4396 335.501C75.5779 335.501 63.8038 332.912 54.1174 327.735C44.4309 322.557 36.9155 315.46 31.5713 306.441C26.394 297.256 23.4714 286.734 22.8033 274.877C22.4693 269.031 22.2188 261.6 22.0518 252.581C21.8848 243.396 21.7178 233.542 21.5508 223.021C21.5508 212.332 21.5508 201.811 21.5508 191.456C21.5508 181.102 21.5508 171.666 21.5508 163.148C21.7178 154.464 21.8013 147.533 21.8013 142.356C21.8013 137.178 21.8013 134.59 21.8013 134.59C23.6384 134.256 26.8115 134.172 31.3208 134.339C35.997 134.506 40.8402 135.258 45.8505 136.594C51.5287 137.93 56.706 140.185 61.3822 143.358C66.2255 146.531 68.9811 151.124 69.6491 157.136C70.1501 162.146 70.1501 169.662 69.6491 179.682C69.3151 189.536 68.9811 200.892 68.6471 213.752C68.4801 226.444 68.8141 239.638 69.6491 253.333C69.8161 256.172 69.8996 259.428 69.8996 263.103C69.8996 266.777 70.4007 270.367 71.4027 273.875C72.5718 277.382 74.8264 280.304 78.1665 282.643C81.6737 284.981 87.018 286.15 94.1993 286.15C101.381 286.15 106.808 285.148 110.483 283.144C114.324 281.139 117.079 278.384 118.75 274.877C120.42 271.37 121.422 267.278 121.756 262.602C122.257 257.925 122.674 252.915 123.008 247.571C123.342 244.064 123.426 238.886 123.259 232.039C123.259 225.192 123.175 217.509 123.008 208.992C122.841 200.475 122.591 191.874 122.257 183.189C121.923 174.505 121.589 166.488 121.255 159.14C120.921 151.792 120.67 145.863 120.503 141.354C120.336 136.844 120.253 134.59 120.253 134.59C122.09 134.256 125.263 134.172 129.772 134.339C134.448 134.506 139.375 135.258 144.552 136.594C150.231 137.93 152.105 137.929 156.781 141.269C161.457 144.442 167.432 151.291 168.1 157.136Z" fill="currentColor"/>
              <path d="M376.988 62.0732L374.816 76.0713C368.713 115.352 350.05 145.351 325.749 153.933L317.382 156.89C310.35 193.195 292.409 220.62 269.397 228.742L257.287 233.015C250.255 269.309 232.314 296.744 209.302 304.866L209.303 304.867L133.264 331.716L133.154 331.899H132.574L132.383 330.776L131.729 330.387L144.44 309.095C154.083 292.942 161.644 272.008 165.712 250.149L165.728 250.056L165.731 250.03C169 232.819 170.1 215.463 169.02 198.446L169.019 198.435L168.98 197.701C168.811 194.652 168.516 191.275 168.058 187.367L167.906 186.134C166.352 173.83 163.67 162.207 159.925 151.55L159.547 150.487L155.669 139.731L155.328 138.784L156.277 138.449L375.668 60.9766L377.245 60.4199L376.988 62.0732ZM176.809 261.424C173.943 274.961 169.915 288.097 164.98 300.095L206.407 285.469C222.289 279.853 235.498 262.452 242.473 238.234L176.809 261.424ZM182.074 204.651C182.395 216.297 181.845 228.024 180.427 239.727L265.836 209.568V209.558L266.503 209.322C282.384 203.717 295.594 186.316 302.568 162.099L182.074 204.651ZM174.41 152.441C177.199 162.313 179.261 172.763 180.565 183.646L180.572 183.704V183.754C180.612 184.082 180.646 184.407 180.683 184.729L210.891 174.064L319.323 135.776L319.324 135.775L321.691 134.941L321.686 134.932L322.841 134.523C338.747 128.908 351.963 111.497 358.92 87.2891L174.41 152.441Z" fill="currentColor" stroke="currentColor" strokeWidth="2"/>
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-wider text-white">
              UNICE
            </h1>
          </div>
        </div>

        {/* Global search */}
        <div className="hidden md:flex items-center bg-zinc-900 border border-white/10 rounded-xl px-4 py-1.5 w-96 gap-2">
          <Search className="w-4 h-4 text-zinc-400" />
          <input
            type="text"
            placeholder="Search prediction markets or leagues..."
            className="bg-transparent border-none outline-none text-sm w-full text-zinc-200 placeholder-zinc-500"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="text-zinc-500 hover:text-zinc-300 cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-4">
          {account && (
            <div className="flex items-center gap-4 bg-zinc-900 border border-white/10 px-4 py-1.5 rounded-xl">
              {/* Mint Faucet */}
              <button
                onClick={handleMintUSDC}
                disabled={txLoading.type === "mint"}
                className="flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white font-bold text-xs py-1 px-3.5 rounded-lg transition duration-200 disabled:opacity-50 cursor-pointer"
              >
                {txLoading.type === "mint" ? (
                  <RefreshCw className="w-3 h-3 animate-spin" />
                ) : (
                  <Coins className="w-3.5 h-3.5" />
                )}
                Mint USDC
              </button>

              <div className="h-4 w-[1px] bg-white/10"></div>

              {/* Balance */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400 font-medium">USDC Balance:</span>
                <span className="text-sm font-bold text-zinc-100 font-mono">${usdcBalance}</span>
              </div>
            </div>
          )}

          {/* Connect button */}
          {account ? (
            <button
              onClick={disconnectWallet}
              className="flex items-center gap-2 bg-zinc-900 hover:bg-zinc-850 border border-white/10 text-white text-xs font-semibold px-4 py-2 rounded-xl transition duration-200 cursor-pointer"
            >
              <Wallet className="w-4 h-4 text-zinc-400" />
              <span>{account.slice(0, 6)}...{account.slice(-4)}</span>
            </button>
          ) : (
            <button
              onClick={connectWallet}
              className="flex items-center gap-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-900 text-xs font-bold px-4 py-2.5 rounded-xl cursor-pointer transition"
            >
              <Wallet className="w-4 h-4" />
              Connect Wallet
            </button>
          )}

          {/* Create game */}
          <button
            onClick={() => {
              if (!account) {
                triggerAlert("warning", "Please connect your wallet to create a market.");
              } else {
                setShowCreateModal(true);
              }
            }}
            className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-750 text-white text-xs font-bold px-4.5 py-2.5 rounded-xl cursor-pointer transition"
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Create Game</span>
          </button>
        </div>
      </header>

      {/* Main Grid */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-6 p-6">

        {/* Sidebar Nav (Left) */}
        <aside className="lg:col-span-1 flex flex-col gap-6">
          <div className="glass-panel p-5 rounded-2xl flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-zinc-400 tracking-wider uppercase">
              Prediction Categories
            </h2>
            <nav className="flex flex-col gap-1.5">
              <button
                onClick={() => setSelectedCategory("all")}
                className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-semibold transition cursor-pointer ${selectedCategory === "all" ? "bg-zinc-800 border border-zinc-600 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
                  }`}
              >
                <div className="flex items-center gap-2.5">
                  <Activity className="w-4.5 h-4.5 text-zinc-400" />
                  <span>All Categories</span>
                </div>
                <span className="text-xs bg-zinc-900 px-2 py-0.5 rounded-full border border-white/10 font-bold font-mono text-zinc-300">
                  {markets.length}
                </span>
              </button>
              <button
                onClick={() => setSelectedCategory("worldcup")}
                className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-semibold transition cursor-pointer ${selectedCategory === "worldcup" ? "bg-zinc-800 border border-zinc-600 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
                  }`}
              >
                <div className="flex items-center gap-2.5">
                  <Trophy className="w-4.5 h-4.5 text-zinc-400" />
                  <span>World Cup 2026</span>
                </div>
                <span className="text-xs bg-zinc-900 px-2 py-0.5 rounded-full border border-white/10 font-bold font-mono text-zinc-300">
                  {markets.filter(m => m.category === "worldcup").length}
                </span>
              </button>
              <button
                onClick={() => setSelectedCategory("politics")}
                className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-semibold transition cursor-pointer ${selectedCategory === "politics" ? "bg-zinc-800 border border-zinc-600 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
                  }`}
              >
                <div className="flex items-center gap-2.5">
                  <Vote className="w-4.5 h-4.5 text-zinc-400" />
                  <span>Global Politics</span>
                </div>
                <span className="text-xs bg-zinc-900 px-2 py-0.5 rounded-full border border-white/10 font-bold font-mono text-zinc-300">
                  {markets.filter(m => m.category === "politics").length}
                </span>
              </button>
              <button
                onClick={() => setSelectedCategory("crypto")}
                className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-semibold transition cursor-pointer ${selectedCategory === "crypto" ? "bg-zinc-800 border border-zinc-600 text-white" : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40"
                  }`}
              >
                <div className="flex items-center gap-2.5">
                  <Coins className="w-4.5 h-4.5 text-zinc-400" />
                  <span>Crypto Markets</span>
                </div>
                <span className="text-xs bg-zinc-900 px-2 py-0.5 rounded-full border border-white/10 font-bold font-mono text-zinc-300">
                  {markets.filter(m => m.category === "crypto").length}
                </span>
              </button>
            </nav>
          </div>
        </aside>

        {/* Dashboard Center Feed (Middle) */}
        <main className="lg:col-span-2 flex flex-col gap-6">
          {/* Banner Hero */}
          <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-zinc-950 via-zinc-900 to-zinc-950 border border-white/10 p-6 md:p-8 flex flex-col gap-4 shadow-xl">
            <div className="absolute right-0 top-0 bottom-0 opacity-10 pointer-events-none w-1/2 flex items-center justify-center translate-x-10">
              <Trophy className="w-64 h-64 text-zinc-400" />
            </div>
            <div className="relative z-10 flex flex-col items-start gap-2.5 max-w-lg">
              <h2 className="text-2xl md:text-3xl font-extrabold text-white leading-tight">
                Prediction Markets on Unice
              </h2>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Predict outcomes and earn USDC rewards on-chain
              </p>
              <button
                onClick={connectWallet}
                className="mt-2 cursor-pointer flex items-center gap-2 bg-zinc-100 text-zinc-950 hover:bg-zinc-200 font-bold text-xs px-5 py-2.5 rounded-xl transition"
              >
                <span>Bet now</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </section>

          {/* Status Filter Tabs (P2Pbet-style: All / Live / Today / etc.) */}
          <div className="flex items-center gap-1 border-b border-white/8 pb-3">
            {[
              { label: "All", value: "all" },
              { label: "Open", value: "open" },
              { label: "Pending", value: "resolved" },
              { label: "Challenged", value: "challenged" },
              { label: "Finalized", value: "finalized" },
            ].map((tab) => (
              <button
                key={tab.value}
                onClick={() => setStatusFilter(tab.value)}
                className={`px-4 py-2 rounded-lg font-semibold transition cursor-pointer text-xs ${statusFilter === tab.value
                    ? "text-white bg-zinc-800 border border-zinc-700"
                    : "text-zinc-500 hover:text-zinc-300"
                  }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Category Icons Row (P2Pbet-style: Football / Basketball / etc.) */}
          <div className="flex items-center gap-3">
            {[
              { label: "All", value: "all", icon: Activity },
              { label: "World Cup", value: "worldcup", icon: Trophy },
              { label: "Politics", value: "politics", icon: Vote },
              { label: "Crypto", value: "crypto", icon: Coins },
            ].map((cat) => {
              const IconComp = cat.icon;
              return (
                <button
                  key={cat.value}
                  onClick={() => setSelectedCategory(cat.value)}
                  className={`flex flex-col items-center gap-2 px-5 py-3 rounded-xl border transition cursor-pointer ${selectedCategory === cat.value
                      ? "bg-zinc-800 border-zinc-600 text-white"
                      : "bg-zinc-900/50 border-white/5 text-zinc-500 hover:text-zinc-300 hover:border-white/10"
                    }`}
                >
                  <IconComp className="w-5 h-5" />
                  <span className="text-[11px] font-semibold">{cat.label}</span>
                </button>
              );
            })}
          </div>

          {/* Best Odds Section (P2Pbet-style horizontal scroll cards) */}
          {featuredMarkets.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-base font-bold text-white">Best odds</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => featuredScrollRef.current?.scrollBy({ left: -340, behavior: "smooth" })}
                    className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-900 border border-white/10 text-zinc-400 hover:text-white hover:border-white/20 transition cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => featuredScrollRef.current?.scrollBy({ left: 340, behavior: "smooth" })}
                    className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-900 border border-white/10 text-zinc-400 hover:text-white hover:border-white/20 transition cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div ref={featuredScrollRef} className="flex gap-4 overflow-x-auto scrollbar-hide pb-2">
                {featuredMarkets.map((market) => {
                  const totalPool = parseFloat(market.totalYesPool) + parseFloat(market.totalNoPool);
                  return (
                    <div key={market.address} className="min-w-[300px] max-w-[300px] bg-zinc-900/60 border border-white/8 rounded-2xl p-4 flex flex-col gap-3 shrink-0 hover:border-white/15 transition">
                      <div className="flex items-center gap-2 text-xs text-zinc-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>
                        <span className="capitalize font-medium">{getCatLabel(market.category)}</span>
                      </div>
                      <h4 className="text-sm font-bold text-white leading-snug min-h-[40px] line-clamp-2">{market.question}</h4>
                      <div className="flex items-center gap-2 text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
                        <Clock className="w-3 h-3" />
                        <span>{formatDeadlineShort(market.bettingDeadline)}</span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setBetslip({ marketAddress: market.address, question: market.question, isYes: true, amount: betslip?.marketAddress === market.address && betslip?.isYes ? betslip.amount : "100" })}
                          className={`flex-1 rounded-xl px-3 py-2.5 flex flex-col gap-1 border transition cursor-pointer ${
                            betslip?.marketAddress === market.address && betslip?.isYes 
                              ? "bg-emerald-500/25 border-emerald-500/60" 
                              : "bg-emerald-950/20 border-emerald-500/10 hover:border-emerald-500/30"
                          }`}
                        >
                          <span className="text-[10px] font-bold text-emerald-400 uppercase">YES</span>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] text-zinc-300 font-mono">${formatPool(market.totalYesPool)}</span>
                            <span className="text-sm font-bold text-emerald-400">{market.yesOdds.toFixed(1)}%</span>
                          </div>
                        </button>
                        <button
                          onClick={() => setBetslip({ marketAddress: market.address, question: market.question, isYes: false, amount: betslip?.marketAddress === market.address && !betslip?.isYes ? betslip.amount : "100" })}
                          className={`flex-1 rounded-xl px-3 py-2.5 flex flex-col gap-1 border transition cursor-pointer ${
                            betslip?.marketAddress === market.address && !betslip?.isYes 
                              ? "bg-rose-500/25 border-rose-500/60" 
                              : "bg-rose-950/20 border-rose-500/10 hover:border-rose-500/30"
                          }`}
                        >
                          <span className="text-[10px] font-bold text-rose-400 uppercase">NO</span>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] text-zinc-300 font-mono">${formatPool(market.totalNoPool)}</span>
                            <span className="text-sm font-bold text-rose-400">{market.noOdds.toFixed(1)}%</span>
                          </div>
                        </button>
                      </div>
                      <div className="text-[10px] text-zinc-500 font-medium">Pool: ${totalPool.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC</div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Top Markets - Category Grouped Rows (P2Pbet-style) */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-zinc-400" />
                Top Markets
              </h3>
              <span className="text-[11px] text-zinc-500 font-medium flex items-center gap-1.5">
                <ListFilter className="w-3.5 h-3.5" />
                {filteredMarkets.length} markets
              </span>
            </div>

            {isLoading ? (
              <div className="flex flex-col gap-2 mt-2">
                {[1, 2, 3, 4].map((n) => (
                  <div key={n} className="h-16 bg-zinc-900/40 border border-white/5 rounded-xl animate-pulse"></div>
                ))}
              </div>
            ) : filteredMarkets.length === 0 ? (
              <div className="glass-panel rounded-2xl p-10 flex flex-col items-center justify-center text-center gap-3 border border-white/12 mt-2">
                <AlertTriangle className="w-12 h-12 text-zinc-500" />
                <h3 className="text-base font-bold text-zinc-300">No prediction markets found</h3>
                <p className="text-xs text-zinc-500 max-w-sm">
                  Try changing filters or category, or deploy a new prediction market using the &quot;Create Game&quot; button.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-1 mt-2">
                {Object.entries(groupedMarkets).map(([cat, catMarkets]) => (
                  <div key={cat} className="flex flex-col">
                    {/* Category Header */}
                    <div className="flex items-center gap-2 py-2.5 px-1">
                      {getCatIconElement(cat)}
                      <span className="text-sm font-semibold text-zinc-300">{getCatLabel(cat)}</span>
                      <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
                    </div>

                    {/* Market Rows */}
                    {(catMarkets as Market[]).map((market) => {
                      const isExpanded = expandedMarket === market.address;
                      const totalPool = parseFloat(market.totalYesPool) + parseFloat(market.totalNoPool);
                      const isOpen = market.status === "OPEN";
                      const isClosed = market.status === "CLOSED";
                      const isPending = market.status === "PENDING";
                      const isFinalized = market.status === "FINALIZED";

                      return (
                        <div key={market.address} className="flex flex-col">
                          {/* Main Row */}
                          <div className={`flex items-center gap-4 py-3 px-3 rounded-xl transition group ${isExpanded ? "bg-white/[0.03]" : "hover:bg-white/[0.02]"}`}>
                            {/* Market Info */}
                            <div className="min-w-[180px] max-w-[240px] flex flex-col gap-0.5 shrink-0">
                              <span className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider flex items-center gap-1.5">
                                <span>{formatDeadlineShort(market.bettingDeadline)}</span>
                                <span>·</span>
                                <span className={`${market.challenged ? "text-rose-400" :
                                    isOpen ? "text-zinc-400" :
                                      isPending ? "text-amber-400" :
                                        isFinalized ? "text-zinc-500" : "text-zinc-500"
                                  }`}>
                                  {market.challenged ? "Challenged" : market.status}
                                </span>
                              </span>
                              <span className="text-sm text-white font-medium leading-snug line-clamp-2">
                                {market.question}
                              </span>
                            </div>

                            {/* Odds Boxes */}
                            <div className="flex gap-2 flex-1 overflow-x-auto scrollbar-hide items-center">
                              {isOpen ? (
                                <>
                                  <button
                                    onClick={() => setBetslip({ marketAddress: market.address, question: market.question, isYes: true, amount: betslip?.marketAddress === market.address && betslip?.isYes ? betslip.amount : "100" })}
                                    className={`shrink-0 rounded-xl px-4 py-2 border flex flex-col gap-0.5 min-w-[130px] cursor-pointer transition ${
                                      betslip?.marketAddress === market.address && betslip?.isYes
                                        ? "bg-emerald-500/25 border-emerald-500/60"
                                        : "bg-emerald-950/20 border-emerald-500/10 hover:border-emerald-500/30"
                                    }`}
                                  >
                                    <span className="text-[10px] font-bold text-emerald-400">YES</span>
                                    <div className="flex items-center justify-between gap-3">
                                      <span className="text-xs text-zinc-300 font-mono">${formatPool(market.totalYesPool)}</span>
                                      <span className="text-sm font-bold text-emerald-400">{market.yesOdds.toFixed(1)}%</span>
                                    </div>
                                  </button>
                                  <button
                                    onClick={() => setBetslip({ marketAddress: market.address, question: market.question, isYes: false, amount: betslip?.marketAddress === market.address && !betslip?.isYes ? betslip.amount : "100" })}
                                    className={`shrink-0 rounded-xl px-4 py-2 border flex flex-col gap-0.5 min-w-[130px] cursor-pointer transition ${
                                      betslip?.marketAddress === market.address && !betslip?.isYes
                                        ? "bg-rose-500/25 border-rose-500/60"
                                        : "bg-rose-950/20 border-rose-500/10 hover:border-rose-500/30"
                                    }`}
                                  >
                                    <span className="text-[10px] font-bold text-rose-400">NO</span>
                                    <div className="flex items-center justify-between gap-3">
                                      <span className="text-xs text-zinc-300 font-mono">${formatPool(market.totalNoPool)}</span>
                                      <span className="text-sm font-bold text-rose-400">{market.noOdds.toFixed(1)}%</span>
                                    </div>
                                  </button>
                                  <div className="shrink-0 rounded-xl px-4 py-2 bg-zinc-900/50 border border-white/5 flex flex-col gap-0.5 min-w-[110px]">
                                    <span className="text-[10px] font-bold text-zinc-500">POOL</span>
                                    <span className="text-xs text-zinc-300 font-mono font-bold">
                                      ${totalPool.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                    </span>
                                  </div>
                                </>
                              ) : (
                                <>
                                  <div className="shrink-0 rounded-xl px-4 py-2 bg-zinc-900/40 border border-white/5 flex flex-col gap-0.5 min-w-[130px]">
                                    <span className="text-[10px] font-bold text-zinc-500">YES</span>
                                    <div className="flex items-center justify-between gap-3">
                                      <span className="text-xs text-zinc-400 font-mono">${formatPool(market.totalYesPool)}</span>
                                      <span className="text-sm font-bold text-zinc-400">{market.yesOdds.toFixed(1)}%</span>
                                    </div>
                                  </div>
                                  <div className="shrink-0 rounded-xl px-4 py-2 bg-zinc-900/40 border border-white/5 flex flex-col gap-0.5 min-w-[130px]">
                                    <span className="text-[10px] font-bold text-zinc-500">NO</span>
                                    <div className="flex items-center justify-between gap-3">
                                      <span className="text-xs text-zinc-400 font-mono">${formatPool(market.totalNoPool)}</span>
                                      <span className="text-sm font-bold text-zinc-400">{market.noOdds.toFixed(1)}%</span>
                                    </div>
                                  </div>
                                  {market.outcome > 0 && (
                                    <div className="shrink-0 rounded-xl px-4 py-2 bg-zinc-800/60 border border-zinc-700 flex flex-col gap-0.5 min-w-[100px]">
                                      <span className="text-[10px] font-bold text-zinc-400">RESULT</span>
                                      <span className="text-sm font-bold text-white">
                                        {market.outcome === 1 ? "YES" : market.outcome === 2 ? "NO" : "INVALID"}
                                      </span>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>

                            {/* Expand Arrow */}
                            <button
                              onClick={() => setExpandedMarket(isExpanded ? null : market.address)}
                              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-white/5 cursor-pointer transition"
                            >
                              {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                          </div>

                          {/* Expanded Detail Panel */}
                          {isExpanded && (
                            <div className="mx-3 mb-3 p-4 bg-zinc-900/40 border border-white/8 rounded-xl flex flex-col gap-4">
                              {/* User positions */}
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                                <div>
                                  <span className="text-zinc-500 block">Your YES Bet:</span>
                                  <span className="font-bold font-mono text-white">${market.userYesShares} USDC</span>
                                </div>
                                <div>
                                  <span className="text-zinc-500 block">Your NO Bet:</span>
                                  <span className="font-bold font-mono text-white">${market.userNoShares} USDC</span>
                                </div>
                                <div>
                                  <span className="text-zinc-500 block">Claimable:</span>
                                  <span className="font-bold font-mono text-zinc-200">${market.claimable} USDC</span>
                                </div>
                                <div>
                                  <span className="text-zinc-500 block">Status:</span>
                                  <span className={`font-bold uppercase ${market.userClaimed ? "text-zinc-400" : "text-zinc-300"}`}>
                                    {market.userClaimed ? "CLAIMED" : "UNCLAIMED"}
                                  </span>
                                </div>
                              </div>

                              {/* Deadline & Contract */}
                              <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-400 border-t border-white/5 pt-3">
                                <span>Deadline: {new Date(market.bettingDeadline * 1000).toLocaleDateString()}</span>
                                <span>Resolution: {new Date(market.resolutionDeadline * 1000).toLocaleDateString()}</span>
                                <a
                                  href={`${BLOCK_EXPLORER}/address/${market.address}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex items-center gap-1 text-zinc-400 hover:text-zinc-200 ml-auto"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                  <span className="font-mono text-[10px]">{market.address.slice(0, 10)}...</span>
                                </a>
                              </div>

                              {/* Action Buttons */}
                              <div className="flex flex-wrap gap-2.5">
                                {isFinalized && !market.userClaimed && parseFloat(market.claimable) > 0 && (
                                  <button
                                    onClick={() => handleClaim(market.address)}
                                    disabled={txLoading.type === "claim"}
                                    className="bg-white hover:bg-zinc-200 text-zinc-950 font-bold text-xs py-2 px-4 rounded-xl flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer shadow-md"
                                  >
                                    {txLoading.type === "claim" && txLoading.address === market.address ? (
                                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <Coins className="w-3.5 h-3.5" />
                                    )}
                                    Claim Winnings
                                  </button>
                                )}
                                {isPending && !market.challenged && (
                                  <button
                                    onClick={() => handleFinalize(market.address)}
                                    disabled={txLoading.type === "finalize"}
                                    className="bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-xs py-2 px-4 rounded-xl flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer border border-zinc-700"
                                  >
                                    {txLoading.type === "finalize" && txLoading.address === market.address ? (
                                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <CheckCircle2 className="w-3.5 h-3.5" />
                                    )}
                                    Finalize Market
                                  </button>
                                )}
                                {isPending && !market.challenged && (
                                  <button
                                    onClick={() => handleChallenge(market.address)}
                                    disabled={txLoading.type === "challenge"}
                                    className="bg-rose-950/40 hover:bg-rose-900 border border-rose-500/30 text-rose-200 font-bold text-xs py-2 px-4 rounded-xl flex items-center gap-1.5 transition disabled:opacity-50 cursor-pointer"
                                  >
                                    {txLoading.type === "challenge" && txLoading.address === market.address ? (
                                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                    ) : (
                                      <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                                    )}
                                    Challenge
                                  </button>
                                )}
                              </div>

                              {/* Admin Panel */}
                              {account.toLowerCase() === factoryAdmin.toLowerCase() && (isClosed || isChallenged(market)) && (
                                <div className="p-3.5 bg-zinc-900/60 border border-zinc-800 rounded-xl flex flex-col gap-3">
                                  <div className="flex items-center gap-2">
                                    <Sparkles className="w-4 h-4 text-zinc-400" />
                                    <span className="text-xs font-bold text-zinc-200 uppercase tracking-wider">Admin Actions</span>
                                  </div>
                                  <p className="text-[11px] text-zinc-400 -mt-1">Submit the verified outcome after the event is settled.</p>
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => handleSubmitResult(market.address, 1)}
                                      disabled={txLoading.type === "resolve"}
                                      className="flex-1 bg-zinc-200 hover:bg-zinc-300 text-zinc-950 font-bold text-xs py-2 px-3 rounded-lg transition cursor-pointer"
                                    >
                                      Submit YES
                                    </button>
                                    <button
                                      onClick={() => handleSubmitResult(market.address, 2)}
                                      disabled={txLoading.type === "resolve"}
                                      className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-xs py-2 px-3 rounded-lg transition cursor-pointer border border-zinc-700"
                                    >
                                      Submit NO
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>

        {/* Betslip & Active Bets Panel (Right Sidebar) */}
        <aside className="lg:col-span-1 flex flex-col gap-6">
          {/* Betslip Box */}
          <div className="glass-panel p-5 rounded-2xl flex flex-col gap-4 shadow-xl border border-white/12">
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <h2 className="text-sm font-bold text-white tracking-wide flex items-center gap-2">
                <span>Betslip</span>
              </h2>
              {betslip && (
                <button
                  onClick={() => setBetslip(null)}
                  className="text-zinc-500 hover:text-zinc-300 text-xs font-bold cursor-pointer"
                >
                  Clear
                </button>
              )}
            </div>

            {betslip ? (
              <div className="flex flex-col gap-4 text-xs">
                {/* Active Choice Card */}
                <div className="bg-zinc-900 border border-white/10 p-3.5 rounded-xl flex flex-col gap-2 relative overflow-hidden">
                  <span className="absolute top-0 right-0 px-3 py-1 rounded-bl-xl font-black text-[10px] bg-zinc-800 border-l border-b border-zinc-750 text-zinc-200">
                    {betslip.isYes ? "YES" : "NO"}
                  </span>

                  <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">
                    Your Selection
                  </span>
                  <p className="font-semibold text-zinc-200 max-w-[80%] pr-4">
                    {betslip.question}
                  </p>
                </div>

                {/* Amount Input */}
                <div className="flex flex-col gap-2">
                  <label className="text-zinc-400 font-semibold">Bet Amount (USDC):</label>
                  <div className="flex items-center bg-zinc-900 border border-white/10 rounded-xl px-4 py-2">
                    <input
                      type="number"
                      className="bg-transparent border-none outline-none font-mono font-bold text-base text-white w-full"
                      value={betslip.amount}
                      onChange={(e) => setBetslip({ ...betslip, amount: e.target.value })}
                      min="1"
                    />
                    <span className="text-zinc-400 font-bold font-mono">$</span>
                  </div>

                  {/* Quick select chips */}
                  <div className="grid grid-cols-4 gap-1.5">
                    {["10", "50", "100", "500"].map((val) => (
                      <button
                        key={val}
                        onClick={() => setBetslip({ ...betslip, amount: val })}
                        className="bg-zinc-900 hover:bg-zinc-800 border border-white/10 rounded-lg text-[10px] py-1 text-zinc-300 cursor-pointer font-mono font-semibold"
                      >
                        ${val}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Potential Win info */}
                <div className="bg-zinc-900 border border-white/10 rounded-xl p-3.5 flex flex-col gap-2.5">
                  <div className="flex justify-between items-center">
                    <span className="text-zinc-500 font-medium">Potential Payout:</span>
                    <span className="text-sm font-bold text-zinc-200 font-mono">
                      ${getPotentialWinnings()} USDC
                    </span>
                  </div>
                </div>

                {/* Bet Button */}
                <button
                  onClick={handleBet}
                  disabled={txLoading.type === "bet" || txLoading.type === "approve"}
                  className="w-full bg-white text-zinc-950 font-bold text-xs py-3 rounded-xl cursor-pointer flex items-center justify-center gap-1.5 transition hover:bg-zinc-200"
                >
                  {(txLoading.type === "bet" || txLoading.type === "approve") ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Processing Transaction...</span>
                    </>
                  ) : (
                    <>
                      <Coins className="w-4 h-4" />
                      <span>Place Bet Now</span>
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center p-6 text-zinc-500 gap-2.5">
                <Percent className="w-8 h-8 opacity-40 text-zinc-400" />
                <p className="text-xs">
                  No selection. Click <strong>BET YES</strong> or <strong>BET NO</strong> on any available prediction market to place a bet.
                </p>
              </div>
            )}
          </div>

          {/* Active Positions */}
          <div className="glass-panel p-5 rounded-2xl flex flex-col gap-4 shadow-xl border border-white/12">
            <h2 className="text-sm font-bold text-white tracking-wide border-b border-white/10 pb-2">
              Your Active Positions
            </h2>

            {markets.filter(m => parseFloat(m.userYesShares) > 0 || parseFloat(m.userNoShares) > 0).length === 0 ? (
              <p className="text-xs text-zinc-500 text-center p-4">
                You have no active betting positions.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {markets
                  .filter(m => parseFloat(m.userYesShares) > 0 || parseFloat(m.userNoShares) > 0)
                  .map((m) => (
                    <div key={m.address} className="bg-zinc-900 border border-white/10 p-3 rounded-xl flex flex-col gap-2 text-xs">
                      <span className="text-[10px] text-zinc-500 font-bold block truncate">
                        {m.question}
                      </span>
                      <div className="flex justify-between items-center text-[10px]">
                        <div className="flex gap-2">
                          {parseFloat(m.userYesShares) > 0 && (
                            <span className="bg-zinc-800 text-zinc-300 border border-zinc-700 px-1.5 py-0.5 rounded font-bold font-mono">
                              YES: ${m.userYesShares}
                            </span>
                          )}
                          {parseFloat(m.userNoShares) > 0 && (
                            <span className="bg-zinc-800 text-zinc-300 border border-zinc-700 px-1.5 py-0.5 rounded font-bold font-mono">
                              NO: ${m.userNoShares}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => setExpandedMarket(m.address)}
                          className="text-zinc-400 hover:text-zinc-200 cursor-pointer font-bold"
                        >
                          Detail
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      {/* Create Custom Market Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#121216] border border-white/10 rounded-2xl max-w-md w-full p-6 flex flex-col gap-5 shadow-2xl relative">
            <button
              onClick={() => setShowCreateModal(false)}
              className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-250 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 pb-2 border-b border-white/10">
              <Trophy className="w-5 h-5 text-white" />
              <h3 className="text-base font-bold text-white">Create New Prediction Market</h3>
            </div>

            <form onSubmit={handleCreateMarket} className="flex flex-col gap-4 text-xs">
              <div className="flex flex-col gap-1.5">
                <label className="text-zinc-400 font-semibold">Prediction Question / Topic:</label>
                <textarea
                  required
                  placeholder="Example: Will Argentina reach the World Cup finals in 2026?"
                  className="bg-zinc-900 border border-white/10 rounded-xl px-4 py-3 text-white outline-none focus:border-zinc-500 text-xs h-20 resize-none"
                  value={newMarket.question}
                  onChange={(e) => setNewMarket({ ...newMarket, question: e.target.value })}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-zinc-400 font-semibold">Category:</label>
                <select
                  className="bg-zinc-900 border border-white/10 rounded-xl px-4 py-2.5 text-white outline-none focus:border-zinc-500"
                  value={newMarket.category}
                  onChange={(e) => setNewMarket({ ...newMarket, category: e.target.value })}
                >
                  <option value="worldcup">World Cup 2026</option>
                  <option value="politics">Global Politics</option>
                  <option value="crypto">Crypto Markets</option>
                  <option value="other">Other Categories</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-zinc-400 font-semibold">Betting Deadline (Days):</label>
                  <input
                    type="number"
                    required
                    min="1"
                    className="bg-zinc-900 border border-white/10 rounded-xl px-4 py-2 text-white outline-none focus:border-zinc-500 font-mono"
                    value={newMarket.bettingDeadlineDays}
                    onChange={(e) => setNewMarket({ ...newMarket, bettingDeadlineDays: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-zinc-400 font-semibold">Resolution Deadline (Days):</label>
                  <input
                    type="number"
                    required
                    min="2"
                    className="bg-zinc-900 border border-white/10 rounded-xl px-4 py-2 text-white outline-none focus:border-zinc-500 font-mono"
                    value={newMarket.resolutionDeadlineDays}
                    onChange={(e) => setNewMarket({ ...newMarket, resolutionDeadlineDays: e.target.value })}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={txLoading.type === "create"}
                className="w-full mt-2 bg-white text-zinc-950 font-bold text-xs py-3 rounded-xl transition cursor-pointer flex items-center justify-center gap-1.5 hover:bg-zinc-200"
              >
                {txLoading.type === "create" ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Deploying Market Contract...</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    <span>Launch Market Contract</span>
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="bg-zinc-950/40 border-t border-white/10 py-6 px-6 text-center text-xs text-zinc-500 flex flex-col sm:flex-row items-center justify-between gap-4">
        <span>© 2026 Unice Prediction Market on Arbitrum Sepolia. Hackathon MVP Demo.</span>
        <div className="flex gap-4">
          <a href={BLOCK_EXPLORER} target="_blank" rel="noreferrer" className="hover:text-zinc-350 flex items-center gap-1">
            <span>Explorer</span>
            <ExternalLink className="w-3 h-3" />
          </a>
          <a href="https://sepolia-rollup.arbitrum.io/rpc" target="_blank" rel="noreferrer" className="hover:text-zinc-350 flex items-center gap-1">
            <span>Arbitrum RPC</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </footer>
    </div>
  );
}

// Small checks helper
function isChallenged(m: Market) {
  return m.challenged;
}

const MOCK_PREVIEW_MARKETS: Market[] = [
  {
    address: "0x56903DbEbB61f3dd5A193FfF83e5b040815FFAC3",
    question: "Will Brazil win the 2026 World Cup?",
    category: "worldcup",
    bettingDeadline: Math.floor(Date.now() / 1000) + 86400 * 25,
    resolutionDeadline: Math.floor(Date.now() / 1000) + 86400 * 40,
    totalYesPool: "15200.00",
    totalNoPool: "12450.00",
    outcome: 0,
    finalized: false,
    status: "OPEN",
    yesOdds: 55,
    noOdds: 45,
    challenged: false,
    submittedAt: 0,
    userYesShares: "0.00",
    userNoShares: "0.00",
    userClaimed: false,
    claimable: "0.00"
  },
  {
    address: "0xE7A119Ec3A03cE80FA45F0cd7a02818290d25561",
    question: "Will Argentina reach the 2026 World Cup final?",
    category: "worldcup",
    bettingDeadline: Math.floor(Date.now() / 1000) + 86400 * 25,
    resolutionDeadline: Math.floor(Date.now() / 1000) + 86400 * 40,
    totalYesPool: "28450.00",
    totalNoPool: "18900.00",
    outcome: 0,
    finalized: false,
    status: "OPEN",
    yesOdds: 60,
    noOdds: 40,
    challenged: false,
    submittedAt: 0,
    userYesShares: "0.00",
    userNoShares: "0.00",
    userClaimed: false,
    claimable: "0.00"
  },
  {
    address: "0xD6f4AE84d063152e9D7ca6400aDEc590897D9f23",
    question: "Will the 2026 World Cup final have more than 3 goals?",
    category: "worldcup",
    bettingDeadline: Math.floor(Date.now() / 1000) + 86400 * 25,
    resolutionDeadline: Math.floor(Date.now() / 1000) + 86400 * 40,
    totalYesPool: "8200.00",
    totalNoPool: "9500.00",
    outcome: 0,
    finalized: false,
    status: "OPEN",
    yesOdds: 46,
    noOdds: 54,
    challenged: false,
    submittedAt: 0,
    userYesShares: "0.00",
    userNoShares: "0.00",
    userClaimed: false,
    claimable: "0.00"
  },
  {
    address: "0xcBCd464905f195900867B67DE94c63f42b413C06",
    question: "Will an African team reach the 2026 World Cup semifinals?",
    category: "worldcup",
    bettingDeadline: Math.floor(Date.now() / 1000) - 3600,
    resolutionDeadline: Math.floor(Date.now() / 1000) + 86400 * 15,
    totalYesPool: "11500.00",
    totalNoPool: "14200.00",
    outcome: 1,
    finalized: false,
    status: "PENDING",
    yesOdds: 45,
    noOdds: 55,
    challenged: false,
    submittedAt: Math.floor(Date.now() / 1000) - 600,
    userYesShares: "0.00",
    userNoShares: "0.00",
    userClaimed: false,
    claimable: "0.00"
  },
  {
    address: "0xdb07cC66449551CAD621a91C5E2D558AEAA69621",
    question: "Will the host nation (USA/Mexico/Canada) win the 2026 World Cup?",
    category: "worldcup",
    bettingDeadline: Math.floor(Date.now() / 1000) + 86400 * 25,
    resolutionDeadline: Math.floor(Date.now() / 1000) + 86400 * 40,
    totalYesPool: "9200.00",
    totalNoPool: "18500.00",
    outcome: 0,
    finalized: false,
    status: "OPEN",
    yesOdds: 33,
    noOdds: 67,
    challenged: false,
    submittedAt: 0,
    userYesShares: "0.00",
    userNoShares: "0.00",
    userClaimed: false,
    claimable: "0.00"
  },
  {
    address: "0x9E083ada1e300581055AECC65861CBf047ec06a5",
    question: "Will there be a new EU member state by end of 2026?",
    category: "politics",
    bettingDeadline: Math.floor(Date.now() / 1000) + 86400 * 100,
    resolutionDeadline: Math.floor(Date.now() / 1000) + 86400 * 120,
    totalYesPool: "3500.00",
    totalNoPool: "12000.00",
    outcome: 0,
    finalized: false,
    status: "OPEN",
    yesOdds: 22,
    noOdds: 78,
    challenged: false,
    submittedAt: 0,
    userYesShares: "0.00",
    userNoShares: "0.00",
    userClaimed: false,
    claimable: "0.00"
  },
  {
    address: "0xF1158f993b8f52618059861FcB563cDF95bF8518",
    question: "Will the US Federal Reserve cut interest rates before July 2026?",
    category: "politics",
    bettingDeadline: Math.floor(Date.now() / 1000) + 86400 * 15,
    resolutionDeadline: Math.floor(Date.now() / 1000) + 86400 * 30,
    totalYesPool: "24500.00",
    totalNoPool: "12300.00",
    outcome: 0,
    finalized: false,
    status: "OPEN",
    yesOdds: 66,
    noOdds: 34,
    challenged: false,
    submittedAt: 0,
    userYesShares: "0.00",
    userNoShares: "0.00",
    userClaimed: false,
    claimable: "0.00"
  },
  {
    address: "0xBE67bdFd441933dd5373E53d68e28c4cABF14245",
    question: "Will a G7 country change its head of state in 2026?",
    category: "politics",
    bettingDeadline: Math.floor(Date.now() / 1000) + 86400 * 180,
    resolutionDeadline: Math.floor(Date.now() / 1000) + 86400 * 200,
    totalYesPool: "15000.00",
    totalNoPool: "14500.00",
    outcome: 0,
    finalized: false,
    status: "OPEN",
    yesOdds: 51,
    noOdds: 49,
    challenged: false,
    submittedAt: 0,
    userYesShares: "0.00",
    userNoShares: "0.00",
    userClaimed: false,
    claimable: "0.00"
  },
  {
    address: "0xd8dBc7CCF432163568ad50f35BBb6E42d038855A",
    question: "Will the UN Security Council add a new permanent member by 2026?",
    category: "politics",
    bettingDeadline: Math.floor(Date.now() / 1000) + 86400 * 200,
    resolutionDeadline: Math.floor(Date.now() / 1000) + 86400 * 220,
    totalYesPool: "1200.00",
    totalNoPool: "22000.00",
    outcome: 0,
    finalized: false,
    status: "OPEN",
    yesOdds: 5,
    noOdds: 95,
    challenged: false,
    submittedAt: 0,
    userYesShares: "0.00",
    userNoShares: "0.00",
    userClaimed: false,
    claimable: "0.00"
  }
];
