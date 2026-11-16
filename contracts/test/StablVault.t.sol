// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StablVault, IERC20} from "../src/StablVault.sol";
import {MockUSDC} from "./MockUSDC.sol";

contract StablVaultTest is Test {
    MockUSDC usdc;
    StablVault vault;

    address operator = makeAddr("operator");
    address jemaya = makeAddr("jemaya");
    address jordan = makeAddr("jordan");
    address thief = makeAddr("thief");

    uint256 constant USD = 1e6; // one dollar of USDC
    bytes32 constant REF_A = bytes32(uint256(0xA));
    bytes32 constant REF_B = bytes32(uint256(0xB));
    bytes32 constant REF_C = bytes32(uint256(0xC));

    event Deposited(address indexed owner, uint256 amount, bytes32 indexed ref, uint256 balance);
    event Released(address indexed owner, uint256 amount, bytes32 indexed ref, uint256 balance);
    event EmergencyUnlocked(address indexed owner, uint256 amount, bytes32 indexed ref, uint256 balance);
    event Frozen(address indexed owner, address indexed by);
    event Unfrozen(address indexed owner);

    function setUp() public {
        usdc = new MockUSDC();
        vault = new StablVault(IERC20(address(usdc)), operator);
        usdc.mint(operator, 1_000_000 * USD);
        vm.prank(operator);
        usdc.approve(address(vault), type(uint256).max);
    }

    function _deposit(address owner, uint256 amount, bytes32 ref) internal {
        vm.prank(operator);
        vault.deposit(owner, amount, ref);
    }

    // ---- setup ----

    function test_ConstructorRejectsZeroAddresses() public {
        vm.expectRevert(StablVault.ZeroAddress.selector);
        new StablVault(IERC20(address(0)), operator);
        vm.expectRevert(StablVault.ZeroAddress.selector);
        new StablVault(IERC20(address(usdc)), address(0));
    }

    function test_OperatorAndTokenAreFixed() public view {
        assertEq(vault.operator(), operator);
        assertEq(address(vault.usdc()), address(usdc));
    }

    // ---- deposit ----

    function test_DepositCreditsOwnerAndPullsFromOperator() public {
        uint256 before = usdc.balanceOf(operator);

        vm.expectEmit(true, true, false, true, address(vault));
        emit Deposited(jemaya, 650 * USD, REF_A, 650 * USD);
        _deposit(jemaya, 650 * USD, REF_A);

        assertEq(vault.balanceOf(jemaya), 650 * USD);
        assertEq(vault.totalHeld(), 650 * USD);
        assertEq(usdc.balanceOf(address(vault)), 650 * USD);
        assertEq(usdc.balanceOf(operator), before - 650 * USD);
        assertTrue(vault.settled(REF_A));
    }

    function test_OnlyOperatorCanDeposit() public {
        usdc.mint(thief, 100 * USD);
        vm.startPrank(thief);
        usdc.approve(address(vault), type(uint256).max);
        vm.expectRevert(StablVault.NotOperator.selector);
        vault.deposit(thief, 100 * USD, REF_A);
        vm.stopPrank();
    }

    function test_DepositRejectsZeroAmountAndZeroOwner() public {
        vm.startPrank(operator);
        vm.expectRevert(StablVault.ZeroAmount.selector);
        vault.deposit(jemaya, 0, REF_A);
        vm.expectRevert(StablVault.ZeroAddress.selector);
        vault.deposit(address(0), 1 * USD, REF_A);
        vm.stopPrank();
    }

    function test_AReferenceSettlesOnlyOnce() public {
        _deposit(jemaya, 650 * USD, REF_A);

        vm.startPrank(operator);
        vm.expectRevert(StablVault.ReferenceUsed.selector);
        vault.deposit(jemaya, 650 * USD, REF_A);
        // The same reference cannot be reused for a different kind of move either.
        vm.expectRevert(StablVault.ReferenceUsed.selector);
        vault.release(jemaya, 100 * USD, REF_A);
        vm.stopPrank();

        assertEq(vault.balanceOf(jemaya), 650 * USD);
    }

    function test_DepositRevertsWhenTokenTransferFails() public {
        usdc.setFailTransfers(true);
        vm.prank(operator);
        vm.expectRevert(StablVault.TransferFailed.selector);
        vault.deposit(jemaya, 650 * USD, REF_A);
        usdc.setFailTransfers(false);

        // Nothing was recorded, and the reference is still free.
        assertEq(vault.balanceOf(jemaya), 0);
        assertFalse(vault.settled(REF_A));
    }

    // ---- release: the closed loop ----

    function test_ReleasePaysTheOwnerAndNobodyElse() public {
        _deposit(jemaya, 650 * USD, REF_A);
        uint256 operatorBefore = usdc.balanceOf(operator);

        vm.expectEmit(true, true, false, true, address(vault));
        emit Released(jemaya, 217 * USD, REF_B, 433 * USD);
        vm.prank(operator);
        vault.release(jemaya, 217 * USD, REF_B);

        assertEq(usdc.balanceOf(jemaya), 217 * USD, "owner is paid");
        assertEq(usdc.balanceOf(operator), operatorBefore, "operator gains nothing");
        assertEq(vault.balanceOf(jemaya), 433 * USD);
        assertEq(vault.totalHeld(), 433 * USD);
        assertEq(usdc.balanceOf(address(vault)), 433 * USD);
    }

    function test_OnlyOperatorCanRelease() public {
        _deposit(jemaya, 650 * USD, REF_A);
        vm.prank(thief);
        vm.expectRevert(StablVault.NotOperator.selector);
        vault.release(jemaya, 650 * USD, REF_B);
    }

    function test_OperatorCannotReleaseMoreThanTheOwnerHas() public {
        _deposit(jemaya, 100 * USD, REF_A);
        _deposit(jordan, 900 * USD, REF_B);

        // Jordan's money is in the same contract, but it is not Jemaya's to receive.
        vm.prank(operator);
        vm.expectRevert(StablVault.InsufficientBalance.selector);
        vault.release(jemaya, 101 * USD, REF_C);

        assertEq(vault.balanceOf(jordan), 900 * USD);
    }

    function test_VaultsAreSeparate() public {
        _deposit(jemaya, 650 * USD, REF_A);
        _deposit(jordan, 300 * USD, REF_B);

        vm.prank(operator);
        vault.release(jordan, 300 * USD, REF_C);

        assertEq(vault.balanceOf(jemaya), 650 * USD);
        assertEq(vault.balanceOf(jordan), 0);
        assertEq(usdc.balanceOf(jordan), 300 * USD);
        assertEq(usdc.balanceOf(jemaya), 0);
    }

    function test_ReleaseRevertsWhenTokenTransferFails() public {
        _deposit(jemaya, 650 * USD, REF_A);
        usdc.setFailTransfers(true);
        vm.prank(operator);
        vm.expectRevert(StablVault.TransferFailed.selector);
        vault.release(jemaya, 100 * USD, REF_B);
        usdc.setFailTransfers(false);

        assertEq(vault.balanceOf(jemaya), 650 * USD);
        assertFalse(vault.settled(REF_B));
    }

    // ---- emergency unlock ----

    function test_OwnerCanTakeTheirMoneyOutWithoutTheOperator() public {
        _deposit(jemaya, 650 * USD, REF_A);

        vm.expectEmit(true, true, false, true, address(vault));
        emit EmergencyUnlocked(jemaya, 150 * USD, REF_B, 500 * USD);
        vm.prank(jemaya);
        vault.emergencyUnlock(150 * USD, REF_B);

        assertEq(usdc.balanceOf(jemaya), 150 * USD);
        assertEq(vault.balanceOf(jemaya), 500 * USD);
    }

    function test_NobodyCanEmergencyUnlockSomeoneElsesMoney() public {
        _deposit(jemaya, 650 * USD, REF_A);

        // The thief has no vault balance of their own, so there is nothing to take.
        vm.prank(thief);
        vm.expectRevert(StablVault.InsufficientBalance.selector);
        vault.emergencyUnlock(1 * USD, REF_B);

        // Not even the operator can use the owner's exit.
        vm.prank(operator);
        vm.expectRevert(StablVault.InsufficientBalance.selector);
        vault.emergencyUnlock(1 * USD, REF_C);

        assertEq(vault.balanceOf(jemaya), 650 * USD);
    }

    function test_EmergencyUnlockCannotExceedBalance() public {
        _deposit(jemaya, 650 * USD, REF_A);
        vm.prank(jemaya);
        vm.expectRevert(StablVault.InsufficientBalance.selector);
        vault.emergencyUnlock(651 * USD, REF_B);
    }

    // ---- freeze ----

    function test_FrozenVaultMovesNothing() public {
        _deposit(jemaya, 650 * USD, REF_A);

        vm.expectEmit(true, true, false, true, address(vault));
        emit Frozen(jemaya, jemaya);
        vm.prank(jemaya);
        vault.freeze();
        (uint256 balance, bool isFrozen) = vault.vaultOf(jemaya);
        assertEq(balance, 650 * USD);
        assertTrue(isFrozen);

        vm.startPrank(operator);
        vm.expectRevert(StablVault.VaultFrozen.selector);
        vault.deposit(jemaya, 10 * USD, REF_B);
        vm.expectRevert(StablVault.VaultFrozen.selector);
        vault.release(jemaya, 10 * USD, REF_B);
        vm.stopPrank();

        vm.prank(jemaya);
        vm.expectRevert(StablVault.VaultFrozen.selector);
        vault.emergencyUnlock(10 * USD, REF_B);

        assertEq(vault.balanceOf(jemaya), 650 * USD);
        assertFalse(vault.settled(REF_B));
    }

    function test_FreezingOneVaultLeavesOthersWorking() public {
        _deposit(jemaya, 650 * USD, REF_A);
        vm.prank(jemaya);
        vault.freeze();

        _deposit(jordan, 300 * USD, REF_B);
        assertEq(vault.balanceOf(jordan), 300 * USD);
    }

    function test_OnlyTheOwnerCanUnfreeze() public {
        _deposit(jemaya, 650 * USD, REF_A);
        vm.prank(jemaya);
        vault.freeze();

        // unfreeze() acts on the caller's own vault, so nobody can unfreeze another's.
        vm.prank(operator);
        vm.expectRevert(StablVault.NotFrozen.selector);
        vault.unfreeze();
        assertTrue(vault.frozen(jemaya));

        vm.expectEmit(true, false, false, true, address(vault));
        emit Unfrozen(jemaya);
        vm.prank(jemaya);
        vault.unfreeze();
        assertFalse(vault.frozen(jemaya));

        vm.prank(operator);
        vault.release(jemaya, 100 * USD, REF_B);
        assertEq(usdc.balanceOf(jemaya), 100 * USD);
    }

    function test_OperatorCanFreezeForAnOwnerButNotUnfreeze() public {
        _deposit(jemaya, 650 * USD, REF_A);

        vm.expectEmit(true, true, false, true, address(vault));
        emit Frozen(jemaya, operator);
        vm.prank(operator);
        vault.freezeFor(jemaya);
        assertTrue(vault.frozen(jemaya));

        vm.prank(thief);
        vm.expectRevert(StablVault.NotOperator.selector);
        vault.freezeFor(jordan);

        vm.prank(jemaya);
        vault.unfreeze();
        assertFalse(vault.frozen(jemaya));
    }

    function test_FreezingTwiceIsHarmless() public {
        vm.startPrank(jemaya);
        vault.freeze();
        vault.freeze();
        assertTrue(vault.frozen(jemaya));
        vault.unfreeze();
        vm.expectRevert(StablVault.NotFrozen.selector);
        vault.unfreeze();
        vm.stopPrank();
    }

    // ---- properties ----

    /// The contract always holds exactly what it owes, whatever is deposited and released.
    function testFuzz_ContractHoldsExactlyWhatItOwes(uint96 a, uint96 b, uint96 outA, uint96 outB) public {
        uint256 inA = bound(uint256(a), 1, 400_000 * USD);
        uint256 inB = bound(uint256(b), 1, 400_000 * USD);
        uint256 takeA = bound(uint256(outA), 1, inA);
        uint256 takeB = bound(uint256(outB), 1, inB);

        _deposit(jemaya, inA, bytes32(uint256(1)));
        _deposit(jordan, inB, bytes32(uint256(2)));
        vm.prank(operator);
        vault.release(jemaya, takeA, bytes32(uint256(3)));
        vm.prank(jordan);
        vault.emergencyUnlock(takeB, bytes32(uint256(4)));

        assertEq(vault.balanceOf(jemaya), inA - takeA);
        assertEq(vault.balanceOf(jordan), inB - takeB);
        assertEq(vault.totalHeld(), vault.balanceOf(jemaya) + vault.balanceOf(jordan));
        assertEq(usdc.balanceOf(address(vault)), vault.totalHeld());
        assertEq(usdc.balanceOf(jemaya), takeA);
        assertEq(usdc.balanceOf(jordan), takeB);
    }

    /// Whoever calls, and whatever they ask for, money leaving a vault lands with its owner.
    function testFuzz_MoneyOnlyEverReachesTheOwner(address caller, uint96 amount) public {
        vm.assume(caller != address(0) && caller != address(vault) && caller != jemaya);
        uint256 take = bound(uint256(amount), 1, 650 * USD);
        _deposit(jemaya, 650 * USD, REF_A);
        uint256 callerBefore = usdc.balanceOf(caller);

        vm.startPrank(caller);
        try vault.release(jemaya, take, REF_B) {} catch {}
        try vault.emergencyUnlock(take, REF_C) {} catch {}
        vm.stopPrank();

        assertEq(usdc.balanceOf(caller), callerBefore, "caller never receives the owner's money");
        assertEq(usdc.balanceOf(jemaya) + vault.balanceOf(jemaya), 650 * USD, "the owner still has all of it");
    }
}
