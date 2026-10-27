//! A CW20 token for QoreChain.
//!
//! The token logic is `cw20-base` from cw-plus, used as a library; this crate
//! only exports its entry points. Add your own behaviour around them.

#[cfg(not(feature = "library"))]
use cosmwasm_std::entry_point;
use cosmwasm_std::{Binary, Deps, DepsMut, Env, MessageInfo, Response, StdResult};
use cw20_base::msg::{ExecuteMsg, InstantiateMsg, MigrateMsg, QueryMsg};
use cw20_base::ContractError;

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn instantiate(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: InstantiateMsg,
) -> Result<Response, ContractError> {
    cw20_base::contract::instantiate(deps, env, info, msg)
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn execute(
    deps: DepsMut,
    env: Env,
    info: MessageInfo,
    msg: ExecuteMsg,
) -> Result<Response, ContractError> {
    cw20_base::contract::execute(deps, env, info, msg)
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn query(deps: Deps, env: Env, msg: QueryMsg) -> StdResult<Binary> {
    cw20_base::contract::query(deps, env, msg)
}

#[cfg_attr(not(feature = "library"), entry_point)]
pub fn migrate(deps: DepsMut, env: Env, msg: MigrateMsg) -> Result<Response, ContractError> {
    cw20_base::contract::migrate(deps, env, msg)
}

#[cfg(test)]
mod tests {
    use super::*;
    use cosmwasm_std::{Addr, Empty, Uint128};
    use cw20::{BalanceResponse, Cw20Coin, TokenInfoResponse};
    use cw_multi_test::{App, Contract, ContractWrapper, Executor};

    fn token() -> Box<dyn Contract<Empty>> {
        Box::new(ContractWrapper::new(execute, instantiate, query))
    }

    #[test]
    fn instantiate_transfer_and_query() {
        let mut app = App::default();
        let owner = app.api().addr_make("owner");
        let alice = app.api().addr_make("alice");
        let code_id = app.store_code(token());

        let addr: Addr = app
            .instantiate_contract(
                code_id,
                owner.clone(),
                &InstantiateMsg {
                    name: "Example Token".to_string(),
                    symbol: "EXT".to_string(),
                    decimals: 6,
                    initial_balances: vec![Cw20Coin {
                        address: owner.to_string(),
                        amount: Uint128::new(1_000_000),
                    }],
                    mint: None,
                    marketing: None,
                },
                &[],
                "example-token",
                None,
            )
            .unwrap();

        let info: TokenInfoResponse = app
            .wrap()
            .query_wasm_smart(&addr, &QueryMsg::TokenInfo {})
            .unwrap();
        assert_eq!(info.symbol, "EXT");
        assert_eq!(info.total_supply, Uint128::new(1_000_000));

        app.execute_contract(
            owner.clone(),
            addr.clone(),
            &ExecuteMsg::Transfer {
                recipient: alice.to_string(),
                amount: Uint128::new(250),
            },
            &[],
        )
        .unwrap();

        let bal: BalanceResponse = app
            .wrap()
            .query_wasm_smart(&addr, &QueryMsg::Balance { address: alice.to_string() })
            .unwrap();
        assert_eq!(bal.balance, Uint128::new(250));
    }
}
