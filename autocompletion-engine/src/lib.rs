mod utils;

use std::collections::HashMap;

use tree_sitter::{Parser, Query, QueryCursor};
use utils::set_panic_hook;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

#[wasm_bindgen]
pub struct AutocompletionEngine {}

/// Public API exposed via WASM.
#[wasm_bindgen]
impl AutocompletionEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        set_panic_hook();

        Self {}
    }

    #[allow(unused_variables)]
    #[wasm_bindgen(js_name = doStuff)]
    pub fn do_stuff(&self) {
        log("doing stuff!");
    }
}

#[allow(dead_code)]
fn main() {
    let code = include_str!("./atom.io.css");
    let mut parser = Parser::new();
    parser
        .set_language(tree_sitter_css::language())
        .expect("Error loading scss grammar");
    let tree = parser.parse(code, None).unwrap();

    let query = Query::new(
        tree_sitter_css::language(),
        r#"(class_selector
        ) @class-name"#,
    )
    .unwrap();
    let mut query_cursor = QueryCursor::new();
    let matches = query_cursor.matches(&query, tree.root_node(), code.as_bytes());
    let mut classes: HashMap<&str, Vec<&str>> = HashMap::new();

    for each_match in matches {
        for capture in each_match.captures {
            let class_name = capture.node.utf8_text(code.as_bytes()).unwrap();
            let _existing = classes.get(class_name);
            // classes.insert(class_name, existing.unwrap_or_default());
            classes.insert(class_name, vec![]);
        }
    }

    dbg!(classes);
}
