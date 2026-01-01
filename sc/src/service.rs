// Copyright (c) Zefchain Labs, Inc.
// SPDX-License-Identifier: Apache-2.0

#![cfg_attr(target_arch = "wasm32", no_main)]

mod state;

use std::sync::Arc;

use async_graphql::{ComplexObject, EmptySubscription, Object, Request, Response, Schema};
use linera_sdk::{linera_base_types::WithServiceAbi, views::View, Service, ServiceRuntime};
use doodle_game::{DoodleGameAbi};

use self::state::DoodleGameState;

linera_sdk::service!(DoodleGameService);

pub struct DoodleGameService {
    state: DoodleGameState,
    runtime: Arc<ServiceRuntime<Self>>,
}

impl WithServiceAbi for DoodleGameService {
    type Abi = DoodleGameAbi;
}

impl Service for DoodleGameService {
    type Parameters = ();

    async fn new(runtime: ServiceRuntime<Self>) -> Self {
        let state = DoodleGameState::load(runtime.root_view_storage_context())
            .await
            .expect("Failed to load state");
        DoodleGameService {
            state,
            runtime: Arc::new(runtime),
        }
    }

    async fn handle_query(&self, request: Request) -> Response {
        let room = self.state.room.get().clone();
        let current_word = self.state.current_word.get().clone();
        let archived_rooms = self.state.archived_rooms.get().clone();
        
        let friends = self.state.friends.get().clone();
        let friend_requests_received = self.state.friend_requests_received.get().clone();
        let friend_requests_sent = self.state.friend_requests_sent.get().clone();
        let room_invitations = self.state.room_invitations.get().clone();
        
        let schema = Schema::build(
            QueryRoot {
                room,
                current_word,
                runtime: self.runtime.clone(),
                archived_rooms,
                friends,
                friend_requests_received,
                friend_requests_sent,
                room_invitations,
            },
            MutationRoot {
                runtime: self.runtime.clone(),
            },
            EmptySubscription,
        )
        .finish();
        
        schema.execute(request).await
    }
}

struct QueryRoot {
    room: Option<doodle_game::GameRoom>,
    current_word: Option<String>,
    runtime: Arc<ServiceRuntime<DoodleGameService>>,
    archived_rooms: Vec<doodle_game::ArchivedRoom>,
    
    // New fields
    friends: Vec<String>,
    friend_requests_received: Vec<String>,
    friend_requests_sent: Vec<String>,
    room_invitations: Vec<doodle_game::Invitation>,
}

#[Object]
impl QueryRoot {
    /// Get the current game room
    async fn room(&self) -> Option<&doodle_game::GameRoom> {
        self.room.as_ref()
    }
    
    /// Get current word (only available on drawer's chain)
    async fn current_word(&self) -> Option<&String> {
        self.current_word.as_ref()
    }
    
    /// Get all players in the room
    async fn players(&self) -> Vec<doodle_game::Player> {
        self.room.as_ref().map_or(Vec::new(), |room| room.players.clone())
    }
    
    /// Get current game state
    async fn game_state(&self) -> Option<doodle_game::GameState> {
        self.room.as_ref().map(|room| room.game_state.clone())
    }
    
    /// Get current drawer
    async fn current_drawer(&self) -> Option<doodle_game::Player> {
        self.room.as_ref().and_then(|room| room.get_current_drawer().cloned())
    }
    
    /// Get leaderboard (players sorted by score)
    async fn leaderboard(&self) -> Vec<doodle_game::Player> {
        self.room.as_ref().map_or(Vec::new(), |room| {
            let mut players = room.players.clone();
            players.sort_by(|a, b| b.score.cmp(&a.score));
            players
        })
    }
    
    /// Get chat messages
    async fn chat_messages(&self) -> Vec<doodle_game::ChatMessage> {
        self.room.as_ref().map_or(Vec::new(), |room| room.chat_messages.clone())
    }
    
    /// Get game progress info
    async fn game_progress(&self) -> Option<GameProgress> {
        self.room.as_ref().map(|room| GameProgress {
            current_round: room.current_round,
            total_rounds: room.total_rounds,
            seconds_per_round: room.seconds_per_round,
            word_chosen_at: room.word_chosen_at.clone(),
        })
    }
    
    /// Check if player has guessed correctly
    async fn player_has_guessed(&self, player_name: String) -> bool {
        self.room.as_ref().map_or(false, |room| {
            room.players.iter().any(|p| p.name == player_name && p.has_guessed)
        })
    }
    
    /// Get player score
    async fn player_score(&self, player_name: String) -> u32 {
        self.room.as_ref().map_or(0, |room| {
            room.players.iter()
                .find(|p| p.name == player_name)
                .map_or(0, |p| p.score)
        })
    }
    
    /// Check if specific player is current drawer
    async fn is_player_drawer(&self, player_name: String) -> bool {
        self.room.as_ref().map_or(false, |room| {
            room.get_current_drawer().map_or(false, |drawer| drawer.name == player_name)
        })
    }
    
    /// Get drawer name (just the name string)
    async fn drawer_name(&self) -> Option<String> {
        self.room.as_ref().and_then(|room| {
            room.get_current_drawer().map(|drawer| drawer.name.clone())
        })
    }

    /// Read a data blob by its hash (64-character hex string)
    /// Returns the blob data as bytes, or None if the hash is invalid
    async fn data_blob(&self, hash: String) -> Option<Vec<u8>> {
        use linera_sdk::linera_base_types::{CryptoHash, DataBlobHash};
        use std::str::FromStr;
        
        match CryptoHash::from_str(&hash) {
            Ok(crypto_hash) => {
                let blob_hash = DataBlobHash(crypto_hash);
                Some(self.runtime.read_data_blob(blob_hash))
            }
            Err(_) => None,
        }
    }

    /// Get archived rooms history (deleted rooms)
    async fn archived_rooms(&self) -> Vec<doodle_game::ArchivedRoom> {
        self.archived_rooms.clone()
    }
    
    /// Get friends list
    async fn friends(&self) -> Vec<String> {
        self.friends.clone()
    }
    
    /// Get received friend requests
    async fn friend_requests_received(&self) -> Vec<String> {
        self.friend_requests_received.clone()
    }
    
    /// Get sent friend requests
    async fn friend_requests_sent(&self) -> Vec<String> {
        self.friend_requests_sent.clone()
    }
    
    /// Get received room invitations
    async fn room_invitations(&self) -> Vec<doodle_game::Invitation> {
        self.room_invitations.clone()
    }
}

#[derive(async_graphql::SimpleObject)]
struct GameProgress {
    current_round: u32,
    total_rounds: u32,
    seconds_per_round: u32,
    word_chosen_at: Option<String>,
}

struct MutationRoot {
    runtime: Arc<ServiceRuntime<DoodleGameService>>,
}

#[Object]
impl MutationRoot {
    /// Create a new game room (host only)
    async fn create_room(&self, host_name: String, avatar_json: Option<String>) -> String {
        self.runtime.schedule_operation(&doodle_game::Operation::CreateRoom { host_name: host_name.clone(), avatar_json: avatar_json.unwrap_or_default() });
        format!("Room created by host '{}'", host_name)
    }
    
    /// Join an existing room
    async fn join_room(&self, host_chain_id: String, player_name: String, avatar_json: Option<String>) -> String {
        self.runtime.schedule_operation(&doodle_game::Operation::JoinRoom { 
            host_chain_id: host_chain_id.clone(), 
            player_name: player_name.clone(),
            avatar_json: avatar_json.unwrap_or_default(),
        });
        format!("Join request sent to host chain '{}' by player '{}'", host_chain_id, player_name)
    }
    
    /// Start the game (host only)
    async fn start_game(&self, rounds: i32, seconds_per_round: i32) -> String {
        let rounds = rounds as u32;
        let seconds_per_round = seconds_per_round as u32;
        self.runtime.schedule_operation(&doodle_game::Operation::StartGame { rounds, seconds_per_round });
        format!("Game started with {} rounds, {} seconds per round", rounds, seconds_per_round)
    }
    
    /// Choose the next drawer (host only)
    async fn choose_drawer(&self) -> String {
        self.runtime.schedule_operation(&doodle_game::Operation::ChooseDrawer);
        "Drawer selection initiated".to_string()
    }
    
    /// Choose a word to draw (drawer only)
    async fn choose_word(&self, word: String) -> String {
        self.runtime.schedule_operation(&doodle_game::Operation::ChooseWord { word: word.clone() });
        format!("Word '{}' chosen", word)
    }
    
    /// Submit a guess for the current word
    async fn guess_word(&self, guess: String) -> String {
        self.runtime.schedule_operation(&doodle_game::Operation::GuessWord { 
            guess: guess.clone() 
        });
        format!("Guess '{}' submitted", guess)
    }
    

    
    /// End the current match and completely delete the room (host only)
    /// WARNING: This permanently deletes the room and disconnects all players
    async fn end_match(&self) -> String {
        self.runtime.schedule_operation(&doodle_game::Operation::EndMatch);
        "Room completely deleted and all players disconnected".to_string()
    }

    async fn leave_room(&self, blob_hashes: Option<Vec<String>>) -> String {
        self.runtime.schedule_operation(&doodle_game::Operation::LeaveRoom { blob_hashes });
        "Leave room request scheduled".to_string()
    }

    /// Schedule reading a data blob by its hash
    /// The hash should be a hex-encoded string of the blob hash (64 characters)
    /// Data blobs must be created externally via CLI `linera publish-data-blob` or GraphQL `publishDataBlob`
    async fn read_data_blob(&self, hash: String) -> String {
        self.runtime.schedule_operation(&doodle_game::Operation::ReadDataBlob { hash: hash.clone() });
        format!("Data blob read scheduled for hash: {}", hash)
    }

    /// Request a friend (send request to target chain)
    async fn request_friend(&self, target_chain_id: String) -> String {
        self.runtime.schedule_operation(&doodle_game::Operation::RequestFriend { target_chain_id: target_chain_id.clone() });
        format!("Friend request sent to '{}'", target_chain_id)
    }
    
    /// Accept a friend request
    async fn accept_friend(&self, requester_chain_id: String) -> String {
        self.runtime.schedule_operation(&doodle_game::Operation::AcceptFriend { requester_chain_id: requester_chain_id.clone() });
        format!("Friend request from '{}' accepted", requester_chain_id)
    }
    
    /// Decline a friend request
    async fn decline_friend(&self, requester_chain_id: String) -> String {
        self.runtime.schedule_operation(&doodle_game::Operation::DeclineFriend { requester_chain_id: requester_chain_id.clone() });
        format!("Friend request from '{}' declined", requester_chain_id)
    }
    
    /// Invite a friend to the current room (must be host)
    async fn invite_friend(&self, friend_chain_id: String) -> String {
        self.runtime.schedule_operation(&doodle_game::Operation::InviteFriend { friend_chain_id: friend_chain_id.clone() });
        format!("Invitation sent to '{}'", friend_chain_id)
    }
    
    /// Accept a room invitation (checks validity and joins room)
    async fn accept_invite(&self, host_chain_id: String, player_name: String, avatar_json: Option<String>) -> String {
        self.runtime.schedule_operation(&doodle_game::Operation::AcceptInvite { 
            host_chain_id: host_chain_id.clone(),
            player_name: player_name.clone(),
            avatar_json: avatar_json.unwrap_or_default(),
        });
        format!("Invitation from '{}' accepted", host_chain_id)
    }
    
    /// Decline a room invitation
    async fn decline_invite(&self, host_chain_id: String) -> String {
        self.runtime.schedule_operation(&doodle_game::Operation::DeclineInvite { host_chain_id: host_chain_id.clone() });
        format!("Invitation from '{}' declined", host_chain_id)
    }
}

#[ComplexObject]
impl DoodleGameState {}
