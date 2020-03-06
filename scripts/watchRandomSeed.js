/*
    - RandomAuRa.currentSeed (value should change every RandomAuRa.collectRoundLength() blocks)
*/

const path = require('path');
const Web3 = require('web3');
const os = require('os');
const fs = require('fs');

const web3 = new Web3('http://localhost:8541');

const checkIntervalMS = 2539; // should be less than block time

const artifactsPath = '../posdao-contracts/build/contracts/';
const node1Path = '../parity-data/node1/';
const checkLogFileName = path.join(__dirname, `${node1Path}/checkRandomSeed.log`);
const checkDebugFileName = path.join(__dirname, `${node1Path}/checkRandomSeedDebug.log`);
fs.writeFileSync(checkLogFileName, '', 'utf8');

var RandomAuRa;
var ValidatorSetAuRa;

var collectRoundLengthBN;
var prevBlock;

let seedState = (function () {
    let lastSeedBN;
    let lastChangeStart = 0;
    return {
        update: function (blockN, currentSeedBN, validatorsLength) {
            let err_reason;
            if (!lastSeedBN || lastSeedBN.isZero()) {
                // not initialized yet
                if (!currentSeedBN.isZero()) {
                    // we start first round here
                    lastChangeStart = blockN;
                }
            }
            else {
                if (blockN - lastChangeStart < validatorsLength) {
                    // validators reveal their shares, so seed should change every block
                    if (currentSeedBN.eq(lastSeedBN)) {
                        err_reason = `seed didn't change in this block, seed value: ${currentSeedBN}, collectRoundLengthBN = ${collectRoundLengthBN}`;
                    }
                }
                else if (blockN - lastChangeStart >= validatorsLength && collectRoundLengthBN.gt(new web3.utils.BN(blockN - lastChangeStart))) {
                    // we are outside of revealing phase but new round has not yet started, so seed should not change
                    if (!currentSeedBN.eq(lastSeedBN)) {
                        err_reason = `seed changed outside of revealing phase, previous value: ${lastSeedBN}, current value: ${currentSeedBN}, collectRoundLengthBN = ${collectRoundLengthBN}, lastChangeStart = ${lastChangeStart}`;
                    }
                }
                else if (collectRoundLengthBN.lte(new web3.utils.BN(blockN - lastChangeStart))) {
                    // new round should start, so seed should change
                    if (currentSeedBN.eq(lastSeedBN)) {
                        err_reason = `seed didn't change in the beginning of a new round, seed value: ${currentSeedBN}, collectRoundLengthBN = ${collectRoundLengthBN}, lastChangeStart = ${lastChangeStart}`;
                    }
                    lastChangeStart = blockN;
                }

            }
            lastSeedBN = currentSeedBN;
            return {
                err: !!err_reason,
                reason: err_reason
            };
        }
    }
})();

// utility functions:
function appendLine(str) {
    fs.appendFileSync(checkLogFileName, `${new Date().toISOString()} ${str}${os.EOL}`, 'utf8');
}

function appendDebug(str) {
    fs.appendFileSync(checkDebugFileName, `${new Date().toISOString()} ${str}${os.EOL}`, 'utf8');
}

function doCheck() {
    Promise.all([
        web3.eth.getBlock('latest', false),
        RandomAuRa.methods.currentSeed().call(),
        ValidatorSetAuRa.methods.getValidators().call(),
    ]).then(results => {
        let block = results[0];
        if (block.number == prevBlock) return;
        prevBlock = block.number;
        let seed = new web3.utils.BN(results[1]);
        let validatorsLength = results[2].length;
        let report = seedState.update(block.number, seed, validatorsLength);
        appendDebug(`[${block.number}]: seed=${seed} author=${block.author} validators=${results[2].join(',')} report=${report.reason||''}`);
        if (report.err) {
            appendLine(`[${block.number}]: report: ${report.reason}`);
        }
    }).catch(e => {
        appendLine(`exception occured: ${e}`);
    });
}

function getValidatorSetContractAddress(currentBlock) {
    let vsBlock;
    let spec = fs.readFileSync(__dirname + '/../parity-data/spec.json', 'utf8');
    spec = JSON.parse(spec);
    for (const hfBlock in spec.engine.authorityRound.params.validators.multi) {
        if (currentBlock >= hfBlock || !currentBlock) {
            vsBlock = hfBlock;
        }
    }
    const multi = spec.engine.authorityRound.params.validators.multi[vsBlock];
    return multi.contract || multi.safeContract;
}

async function main() {
    ValidatorSetAuRa = new web3.eth.Contract(
        require(`${artifactsPath}ValidatorSetAuRa.json`).abi,
        getValidatorSetContractAddress()
    );
    RandomAuRa = new web3.eth.Contract(
        require(`${artifactsPath}RandomAuRa.json`).abi,
        await ValidatorSetAuRa.methods.randomContract().call()
    );
    collectRoundLengthBN = new web3.utils.BN(
        await RandomAuRa.methods.collectRoundLength().call()
    );
    setInterval(doCheck, checkIntervalMS);
}

main();
