// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The part of the ERC-20 interface the vault uses. On Arc, USDC is the
/// native asset and this interface (6 decimals) reads and moves that same balance.
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title StablVault
/// @notice Holds each person's set-aside USDC and enforces Stabl's closed loop:
/// money that goes into a vault can only ever come back out to that vault's owner.
///
/// Rules the contract enforces, whatever Stabl's servers do:
///  1. Closed loop. Every way out pays the vault's owner and nobody else. There is
///     no function that sends an owner's money to another address.
///  2. The operator is limited. Stabl's operator can add money to a vault and send
///     it back to its owner. It cannot redirect, borrow, or sweep anything.
///  3. Freeze. An owner can freeze their vault. While frozen, nothing moves in or
///     out. Only the owner can unfreeze.
///  4. Emergency unlock. An owner can take their own money out without the
///     operator, at any time the vault is not frozen.
///  5. Once only. Every move carries a reference (the app's move id). A reference
///     settles once, so a retried request can never move money twice.
///
/// There is no admin, no pause switch, no fee, and no upgrade path. The operator
/// and the token are fixed at deployment.
contract StablVault {
    /// @notice The USDC token this vault holds.
    IERC20 public immutable usdc;

    /// @notice Stabl's operator: the only address that can deposit or release.
    address public immutable operator;

    /// @notice USDC held for each owner, in the token's smallest unit.
    mapping(address owner => uint256 amount) public balanceOf;

    /// @notice True while an owner's vault is frozen.
    mapping(address owner => bool isFrozen) public frozen;

    /// @notice True once a move reference has settled.
    mapping(bytes32 ref => bool used) public settled;

    /// @notice Sum of every owner's balance. Never more than the USDC the contract holds.
    uint256 public totalHeld;

    event Deposited(address indexed owner, uint256 amount, bytes32 indexed ref, uint256 balance);
    event Released(address indexed owner, uint256 amount, bytes32 indexed ref, uint256 balance);
    event EmergencyUnlocked(address indexed owner, uint256 amount, bytes32 indexed ref, uint256 balance);
    event Frozen(address indexed owner, address indexed by);
    event Unfrozen(address indexed owner);

    error NotOperator();
    error ZeroAddress();
    error ZeroAmount();
    error VaultFrozen();
    error NotFrozen();
    error ReferenceUsed();
    error InsufficientBalance();
    error TransferFailed();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(IERC20 usdc_, address operator_) {
        if (address(usdc_) == address(0) || operator_ == address(0)) revert ZeroAddress();
        usdc = usdc_;
        operator = operator_;
    }

    /// @notice Set money aside for `owner`. The USDC comes from the operator.
    /// @param owner The vault owner being credited.
    /// @param amount USDC in the token's smallest unit.
    /// @param ref The app's id for this move. Settles once.
    function deposit(address owner, uint256 amount, bytes32 ref) external onlyOperator {
        if (owner == address(0)) revert ZeroAddress();
        _begin(owner, amount, ref);

        uint256 balance = balanceOf[owner] + amount;
        balanceOf[owner] = balance;
        totalHeld += amount;
        emit Deposited(owner, amount, ref, balance);

        if (!usdc.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
    }

    /// @notice Give money back to `owner`. It is paid to the owner's own address.
    function release(address owner, uint256 amount, bytes32 ref) external onlyOperator {
        _begin(owner, amount, ref);
        uint256 balance = _debit(owner, amount);
        emit Released(owner, amount, ref, balance);

        if (!usdc.transfer(owner, amount)) revert TransferFailed();
    }

    /// @notice Take your own money out without the operator.
    function emergencyUnlock(uint256 amount, bytes32 ref) external {
        _begin(msg.sender, amount, ref);
        uint256 balance = _debit(msg.sender, amount);
        emit EmergencyUnlocked(msg.sender, amount, ref, balance);

        if (!usdc.transfer(msg.sender, amount)) revert TransferFailed();
    }

    /// @notice Freeze your vault. Nothing moves in or out until you unfreeze it.
    function freeze() external {
        _freeze(msg.sender);
    }

    /// @notice The operator may freeze a vault on the owner's behalf, because
    /// stopping is always safe. It can never unfreeze one.
    function freezeFor(address owner) external onlyOperator {
        _freeze(owner);
    }

    /// @notice Unfreeze your vault. Only the owner can do this.
    function unfreeze() external {
        if (!frozen[msg.sender]) revert NotFrozen();
        frozen[msg.sender] = false;
        emit Unfrozen(msg.sender);
    }

    /// @notice An owner's balance and whether their vault is frozen.
    function vaultOf(address owner) external view returns (uint256 balance, bool isFrozen) {
        return (balanceOf[owner], frozen[owner]);
    }

    function _begin(address owner, uint256 amount, bytes32 ref) private {
        if (amount == 0) revert ZeroAmount();
        if (frozen[owner]) revert VaultFrozen();
        if (settled[ref]) revert ReferenceUsed();
        settled[ref] = true;
    }

    function _debit(address owner, uint256 amount) private returns (uint256 balance) {
        balance = balanceOf[owner];
        if (balance < amount) revert InsufficientBalance();
        unchecked {
            balance -= amount;
        }
        balanceOf[owner] = balance;
        totalHeld -= amount;
    }

    function _freeze(address owner) private {
        if (frozen[owner]) return;
        frozen[owner] = true;
        emit Frozen(owner, msg.sender);
    }
}
