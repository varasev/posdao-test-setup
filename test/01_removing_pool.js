const Web3 = require('web3');
const fs = require('fs');
const path = require('path');
const constants = require('../utils/constants');
const SnS = require('../utils/signAndSendTx.js');
const web3 = new Web3('http://localhost:8541');
web3.eth.transactionConfirmationBlocks = 1;
const BN = web3.utils.BN;
const OWNER = constants.OWNER;
const expect = require('chai')
    .use(require('chai-bn')(BN))
    .use(require('chai-as-promised'))
    .expect;
const waitForValidatorSetChange = require('../utils/waitForValidatorSetChange');
const pp = require('../utils/prettyPrint');
const artifactsPath = '../posdao-contracts/build/contracts/';

var ValidatorSetAuRa;
var StakingAuRa;

describe('Pool removal and validator set change', () => {
    let tiredValidator = {};

    it('Initialize contract instances', async () => {
        ValidatorSetAuRa = new web3.eth.Contract(
          require(`${artifactsPath}ValidatorSetAuRa.json`).abi,
          getValidatorSetContractAddress()
        );
        StakingAuRa = new web3.eth.Contract(
          require(`${artifactsPath}StakingAuRa.json`).abi,
          await ValidatorSetAuRa.methods.stakingContract().call()
        );
    });

    it('The last validator removes his pool', async () => {
        let validators = await ValidatorSetAuRa.methods.getValidators().call();
        console.log('***** Initial validator set = ' + JSON.stringify(validators));
        if (!validators.length == 1) {
            throw new Error('This test cannot be performed because it requires at least 2 validators in the validatorSet');
        }

        tiredValidator.mining = validators[validators.length - 1];
        tiredValidator.staking = await ValidatorSetAuRa.methods.stakingByMiningAddress(tiredValidator.mining).call();
        console.log('***** Validator to be removed: ' + JSON.stringify(tiredValidator));
        const tx = await SnS(web3, {
            from: tiredValidator.staking,
            to: StakingAuRa.options.address,
            method: StakingAuRa.methods.removeMyPool(),
            gasPrice: '1000000000'
        });
        pp.tx(tx);
        expect(tx.status, `Failed tx: ${tx.transactionHash}`).to.equal(true);
    });

    it('Validator is not present in the validator set in the next staking epoch', async () => {
        console.log('***** Wait for staking epoch to change');
        let validators = (await waitForValidatorSetChange(web3, ValidatorSetAuRa, StakingAuRa)).map(v => v.toLowerCase());
        let validatorIndex = validators.indexOf(tiredValidator.mining.toLowerCase());
        expect(validatorIndex, `Validator ${JSON.stringify(tiredValidator)}
            removed his pool but still is in validator set`)
            .to.equal(-1);
    });
});

describe('Unremovable validator removes his pool', () => {
    let unremovableValidator = {};

    it('Owner calls ValidatorSetAuRa.clearUnremovableValidator', async () => {
        unremovableValidator.staking = (await ValidatorSetAuRa.methods.unremovableValidator().call()).toLowerCase();
        unremovableValidator.mining = (await ValidatorSetAuRa.methods.miningByStakingAddress(unremovableValidator.staking).call()).toLowerCase();

        if (unremovableValidator.staking == '0x0000000000000000000000000000000000000000') {
            console.log('***** Unremovable validator doesn\'t exist. Skip this test');
            return;
        }

        const validatorsList = await ValidatorSetAuRa.methods.getValidators().call();
        expect(validatorsList[0].toLowerCase() == unremovableValidator.mining, `Unexpected unremovable validator mining: ${validatorsList[0]}, actual mining: ${unremovableValidator.mining}`)
            .to.equal(true);

        console.log('***** Unremovable validator: ' + JSON.stringify(unremovableValidator));
        console.log('***** OWNER calls clearUnremovableValidator');
        const tx = await SnS(web3, {
            from: OWNER,
            to: ValidatorSetAuRa.options.address,
            method: ValidatorSetAuRa.methods.clearUnremovableValidator(),
            gasPrice: '0',
        });
        pp.tx(tx);
        expect(tx.status, `Failed tx: ${tx.transactionHash}`).to.equal(true);

        const check_unremovableValidator = await ValidatorSetAuRa.methods.unremovableValidator().call();
        console.log('***** ValidatorSetAuRa.unremovableValidator after the call: ' + check_unremovableValidator);
        expect(check_unremovableValidator == '0x0000000000000000000000000000000000000000', 'Unremovable validator is not cleared')
            .to.equal(true);
    });

    it('Ex unremovable validator removes his pool', async() => {
        if (unremovableValidator.staking == '0x0000000000000000000000000000000000000000') {
            console.log('***** Unremovable validator doesn\'t exist. Skip this test');
            return;
        }

        console.log('***** Ex unremovable validator calls StakingAuRa.removeMyPool');
        const tx = await SnS(web3, {
            from: unremovableValidator.staking,
            to: StakingAuRa.options.address,
            method: StakingAuRa.methods.removeMyPool(),
            gasPrice: '1000000000'
        });
        pp.tx(tx);
        expect(tx.status, `Failed tx: ${tx.transactionHash}`).to.equal(true);

        const pools = await StakingAuRa.methods.getPools().call();
        const poolFound = pools.filter(pool => pool.toLowerCase() == unremovableValidator.staking).length > 0;
        expect(poolFound, 'Unremovable validator\'s pool still exists').to.equal(false);

        const validatorsList = await waitForValidatorSetChange(web3, ValidatorSetAuRa, StakingAuRa);
        console.log('***** Validators list after removal = ' + JSON.stringify(validatorsList));
        expect(validatorsList[0].toLowerCase() != unremovableValidator.mining, `Unremovable validator still present in the validators list`)
            .to.equal(true);
    });
});

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
