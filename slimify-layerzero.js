#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const inputPath = args[0] || path.join(__dirname, "layerzero.json");
const outputPath = args[1] || path.join(__dirname, "layerzero-slim.json");

function slimifyDeployment(deployment) {
  if (!deployment || typeof deployment !== "object") {
    return deployment;
  }

  const slim = {};

  if (deployment.eid !== undefined) slim.eid = deployment.eid;
  if (deployment.stage !== undefined) slim.stage = deployment.stage;

  return slim;
}

function slimifyDvn(dvn) {
  if (!dvn || typeof dvn !== "object") {
    return dvn;
  }

  const slim = {};

  if (dvn.canonicalName !== undefined) slim.canonicalName = dvn.canonicalName;
  if (dvn.name !== undefined) slim.name = dvn.name;
  if (dvn.id !== undefined) slim.id = dvn.id;

  return slim;
}

function slimifyChain(chain) {
  if (!chain || typeof chain !== "object") {
    return chain;
  }

  const slim = {};

  if (chain.chainKey !== undefined) {
    slim.chainKey = chain.chainKey;
  }

  if (chain.chainDetails && typeof chain.chainDetails === "object") {
    slim.chainDetails = {};

    if (chain.chainDetails.shortName !== undefined) {
      slim.chainDetails.shortName = chain.chainDetails.shortName;
    }
    if (chain.chainDetails.name !== undefined) {
      slim.chainDetails.name = chain.chainDetails.name;
    }
    if (chain.chainDetails.chainKey !== undefined) {
      slim.chainDetails.chainKey = chain.chainDetails.chainKey;
    }
  }

  if (Array.isArray(chain.deployments)) {
    slim.deployments = chain.deployments.map(slimifyDeployment);
  }

  if (chain.dvns && typeof chain.dvns === "object") {
    slim.dvns = {};
    for (const [address, dvn] of Object.entries(chain.dvns)) {
      slim.dvns[address] = slimifyDvn(dvn);
    }
  }

  return slim;
}

function slimifyLayerzero(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid input data: expected an object");
  }

  const slim = {};
  let filteredCount = 0;

  for (const [chainName, chain] of Object.entries(data)) {
    if (chainName.toLowerCase().includes("testnet")) {
      filteredCount++;
      continue;
    }

    slim[chainName] = slimifyChain(chain);
  }

  return { data: slim, filteredCount };
}

function displayStats(originalSize, slimSize, originalChainCount, slimChainCount, filteredCount) {
  const reduction = originalSize - slimSize;
  const percentReduction = ((reduction / originalSize) * 100).toFixed(2);

  console.log("\n✓ Slimification complete!");
  console.log(`  Original chains:  ${originalChainCount}`);
  console.log(`  Filtered out:     ${filteredCount} testnet chains`);
  console.log(`  Remaining chains: ${slimChainCount}`);
  console.log(`  Original size:    ${(originalSize / 1024).toFixed(2)} KB`);
  console.log(`  Slim size:        ${(slimSize / 1024).toFixed(2)} KB`);
  console.log(`  Reduction:        ${(reduction / 1024).toFixed(2)} KB (${percentReduction}%)`);
}

try {
  console.log("Reading input file:", inputPath);

  if (!fs.existsSync(inputPath)) {
    console.error(`Error: Input file not found: ${inputPath}`);
    process.exit(1);
  }

  const originalContent = fs.readFileSync(inputPath, "utf8");
  const originalSize = Buffer.byteLength(originalContent, "utf8");

  console.log("Parsing JSON...");
  const data = JSON.parse(originalContent);
  const originalChainCount = Object.keys(data).length;

  console.log("Slimifying data...");
  const { data: slimData, filteredCount } = slimifyLayerzero(data);
  const slimChainCount = Object.keys(slimData).length;

  console.log("Writing output file:", outputPath);
  const slimContent = JSON.stringify(slimData);
  const slimSize = Buffer.byteLength(slimContent, "utf8");

  fs.writeFileSync(outputPath, slimContent, "utf8");

  displayStats(originalSize, slimSize, originalChainCount, slimChainCount, filteredCount);
  console.log("\nOutput written to:", outputPath);
} catch (error) {
  console.error("Error:", error.message);
  process.exit(1);
}
