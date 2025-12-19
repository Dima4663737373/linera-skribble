// Copyright (c) Zefchain Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

/*! ABI of the Doodle Game Application */

use async_graphql::{Request, Response};
use linera_sdk::linera_base_types::{ContractAbi, ServiceAbi};
use serde::{Deserialize, Serialize};

pub struct DoodleGameAbi;

impl ContractAbi for DoodleGameAbi {
    type Operation = Operation;
    type Response = ();
}

impl ServiceAbi for DoodleGameAbi {
    type Query = Request;
    type QueryResponse = Response;
}

// Player structure
#[derive(Debug, Clone, Serialize, Deserialize, async_graphql::SimpleObject)]
#[graphql(rename_fields = "camelCase")]
pub struct Player {
    pub chain_id: String,
    pub name: String,
    pub score: u32,
    pub has_guessed: bool,
}

// Drawing will be handled via WebSockets, not smart contracts
// Keeping these structures for potential future use or compatibility
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrawPoint {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DrawPointOutput {
    pub x: i32,
    pub y: i32,
}

// Game room structure
#[derive(Debug, Clone, Serialize, Deserialize, async_graphql::SimpleObject)]
#[graphql(rename_fields = "camelCase")]
pub struct GameRoom {
    pub room_id: String,
    pub host_chain_id: String,
    pub players: Vec<Player>,
    pub game_state: GameState,
    pub current_round: u32,
    pub total_rounds: u32,
    pub seconds_per_round: u32,
    pub current_drawer_index: Option<usize>,
    pub word_chosen_at: Option<String>,  // NEEDED for drawing timer
    pub chat_messages: Vec<ChatMessage>,
    pub drawer_chosen_at: Option<String>, // NEEDED for word selection timer
    pub blob_hashes: Vec<String>, // History of all drawings in the room
}

// Archived room data (stored after deletion)
#[derive(Debug, Clone, Serialize, Deserialize, async_graphql::SimpleObject)]
#[graphql(rename_fields = "camelCase")]
pub struct ArchivedRoom {
    pub room_id: String,
    pub blob_hashes: Vec<String>,
    pub timestamp: String,
}

// Game states
#[derive(Debug, Clone, Copy, Serialize, Deserialize, async_graphql::Enum, PartialEq, Eq)]
pub enum GameState {
    WaitingForPlayers,
    GameStarted,
    ChoosingDrawer,
    WaitingForWord,
    Drawing,
    RoundEnded,
    GameEnded,
}

// Chat message
#[derive(Debug, Clone, Serialize, Deserialize, async_graphql::SimpleObject)]
#[graphql(rename_fields = "camelCase")]
pub struct ChatMessage {
    pub player_name: String,
    pub message: String,
    pub is_correct_guess: bool,
    pub points_awarded: u32,
}

// Game event for history tracking (deprecated - no longer used)
#[derive(Debug, Clone, Serialize, Deserialize, async_graphql::SimpleObject)]
#[graphql(rename_fields = "camelCase")]
pub struct GameEvent {
    pub event_type: String,
    pub description: String,
    pub timestamp: String,
    pub player_name: Option<String>,
    pub round: Option<u32>,
}

// Data Blob info for GraphQL responses
#[derive(Debug, Clone, Serialize, Deserialize, async_graphql::SimpleObject)]
#[graphql(rename_fields = "camelCase")]
pub struct DataBlobInfo {
    pub hash: String,
    pub size: u32,
}

// Operations
#[derive(Debug, Serialize, Deserialize)]
pub enum Operation {
    CreateRoom { host_name: String },
    JoinRoom { host_chain_id: String, player_name: String },
    StartGame { rounds: u32, seconds_per_round: u32 },
    ChooseDrawer, // logic moved to async, no hash needed here
    ChooseWord { word: String },
    GuessWord { guess: String },
    EndMatch,
    LeaveRoom { blob_hashes: Option<Vec<String>> },
    // Data Blob operations (read only - blobs created via CLI/GraphQL)
    ReadDataBlob { hash: String },
}

// Events for cross-chain synchronization
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DoodleEvent {
    PlayerJoined { player: Player, timestamp: String },
    GameStarted { 
        rounds: u32, 
        seconds_per_round: u32, 
        drawer_index: usize, 
        drawer_name: String, 
        timestamp: String 
    },
    DrawerChosen { 
        drawer_index: usize, 
        drawer_name: String, 
        timestamp: String,
        previous_blob_hash: Option<String> 
    },
    WordChosen { timestamp: String },
    ChatMessage { message: ChatMessage },
    RoundEnded { 
        scores: Vec<(String, u32)>, 
        timestamp: String 
    },
    GameEnded { final_scores: Vec<(String, u32)>, timestamp: String },
    MatchEnded { timestamp: String },
}

// Cross-chain messages
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CrossChainMessage {
    JoinRequest { 
        player_chain_id: linera_sdk::linera_base_types::ChainId,
        player_name: String,
    },
    GuessSubmission {
        guesser_chain_id: linera_sdk::linera_base_types::ChainId,
        guess: String,
        round: u32,
    },
    // Initial state sync when player joins (one-time)
    InitialStateSync {
        room_data: GameRoom,
    },
    // Повідомлення про видалення кімнати (відключення всіх гравців)
    RoomDeleted {
        timestamp: String,
        archived_room: Option<ArchivedRoom>,
    },
    PlayerLeft {
        player_chain_id: linera_sdk::linera_base_types::ChainId,
        player_name: Option<String>,
        timestamp: String,
    },
}

impl GameRoom {
    pub fn new(host_chain_id: String, host_name: String, _timestamp: String) -> Self {
        let host_player = Player {
            chain_id: host_chain_id.clone(),
            name: host_name.clone(),
            score: 0,
            has_guessed: false,
        };
        
        Self {
            room_id: _timestamp.clone(),
            host_chain_id,
            players: vec![host_player],
            game_state: GameState::WaitingForPlayers,
            current_round: 0,
            total_rounds: 0,
            seconds_per_round: 0,
            current_drawer_index: None,
            word_chosen_at: None,
            chat_messages: Vec::new(),
            drawer_chosen_at: None,
            blob_hashes: Vec::new(),
        }
    }

    pub fn add_player(&mut self, player: Player) {
        if !self.players.iter().any(|p| p.chain_id == player.chain_id) {
            self.players.push(player);
        }
    }
    
    pub fn start_game(&mut self, rounds: u32, seconds_per_round: u32, _timestamp: String) {
        self.total_rounds = rounds;
        self.seconds_per_round = seconds_per_round;
        self.current_round = 1;
        self.game_state = GameState::ChoosingDrawer;
        
        // Reset all player scores and guessed status
        for player in &mut self.players {
            player.score = 0;
            player.has_guessed = false;
        }
    }

    pub fn choose_drawer(&mut self, timestamp: String) -> Option<usize> {
        if self.players.is_empty() {
            return None;
        }

        let next_index = match self.current_drawer_index {
            None => 0,
            Some(current) => (current + 1) % self.players.len(),
        };

        self.current_drawer_index = Some(next_index);
        self.game_state = GameState::WaitingForWord;
        self.word_chosen_at = None;
        self.drawer_chosen_at = Some(timestamp.clone());
        
        // Reset guessed status for new drawer
        for player in &mut self.players {
            player.has_guessed = false;
        }

        Some(next_index)
    }

    pub fn choose_word(&mut self, timestamp: String) {
        self.word_chosen_at = Some(timestamp);
        self.game_state = GameState::Drawing;
    }

    pub fn add_chat_message(&mut self, message: ChatMessage) {
        self.chat_messages.push(message);
    }

    pub fn advance_to_next_round(&mut self, _timestamp: String) {
        if self.current_round < self.total_rounds {
            self.current_round += 1;
            self.game_state = GameState::ChoosingDrawer;
            // Reset drawer index so choose_drawer() starts from first player in new round
            self.current_drawer_index = None;
            self.word_chosen_at = None;
            
            // MEMORY OPTIMIZATION: Clear chat messages on new round
            self.chat_messages.clear();
        } else {
            self.game_state = GameState::GameEnded;
        }
    }

    pub fn has_all_players_drawn_in_round(&self) -> bool {
        if self.players.is_empty() {
            return false;
        }
        
        // Check if current drawer index would cycle back to 0 (all players have drawn)
        match self.current_drawer_index {
            None => false,
            Some(current_index) => {
                let next_index = (current_index + 1) % self.players.len();
                next_index == 0
            }
        }
    }

    pub fn get_current_drawer(&self) -> Option<&Player> {
        self.current_drawer_index.and_then(|index| self.players.get(index))
    }

    pub fn award_points(&mut self, player_name: &str, points: u32) {
        if let Some(player) = self.players.iter_mut().find(|p| p.name == player_name) {
            player.score += points;
            player.has_guessed = true;
        }
    }

    pub fn end_match(&mut self, _timestamp: String) {
        // Note: This method is now deprecated as endMatch completely deletes the room
        // instead of just resetting it. This is kept for backward compatibility.
        eprintln!("[DEPRECATED] end_match() called - room should be completely deleted instead");
    }
}
