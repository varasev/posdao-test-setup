const RETRY_INTERVAL_MS = 2499;

module.exports = async (web3, validatorSetAuRaContract, stakingAuRaContract) => {
    let initialStakingEpoch = parseInt(await stakingAuRaContract.methods.stakingEpoch().call());
    // wait for the next staking epoch
    while (true) {
        await new Promise(r => setTimeout(r, RETRY_INTERVAL_MS));
        let currentStakingEpoch = parseInt(await stakingAuRaContract.methods.stakingEpoch().call());
        let currentBlock = parseInt((await web3.eth.getBlock('latest')).number);
        if (currentStakingEpoch > initialStakingEpoch) {
            console.log(`***** Staking epoch changed at block ${currentBlock} (new epoch: ${currentStakingEpoch})`);
            break;
        }
    }

    // wait until new validator set is applied
    while (
        parseInt(
            await validatorSetAuRaContract.methods.validatorSetApplyBlock().call()
        ) === 0
    ) {
        await new Promise(r => setTimeout(r, RETRY_INTERVAL_MS));
    }
    let currentBlock = parseInt((await web3.eth.getBlock('latest')).number);
    let validatorSet = await validatorSetAuRaContract.methods.getValidators().call();
    console.log(`***** ValidatorSet change applied at block ${currentBlock}
        (new validator set: ${JSON.stringify(validatorSet)})`);
    return validatorSet;
}
