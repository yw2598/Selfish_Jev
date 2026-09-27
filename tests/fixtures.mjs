import {readFileSync} from 'node:fs';

// Historical mechanics have explicit economic/range fixtures. Current defaults
// and the v0.6 integration are covered by balance.test.mjs.
export const legacyDefaults=JSON.parse(readFileSync(new URL('../defaults.json',import.meta.url),'utf8'));
Object.assign(legacyDefaults,{rulesVersion:'0.5',initialEnergy:80,publicEnergy:200,discoveryReward:50,enemyMineReward:0,killLootEnabled:false,claimFunding:'personal',movementRange:1,attackRange:1,resourceDensity:1});
legacyDefaults.costs.CLAIM=2;
legacyDefaults.decisionMode='kev';
Object.assign(legacyDefaults,{width:32,height:32,resourceCount:null});

Object.assign(legacyDefaults,{territoryTax:0,claimReward:0,contiguousExpansion:false});
