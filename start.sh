#!/bin/bash
# SaaS Starter - TUI Launcher
# Interactive menu for launching in Web or Electron mode, with port management

set -e

# ============================================================================
# CONFIGURATION
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

APP_NAME="SaaS Starter"
SELECTED_OPTION=1
MAX_OPTIONS=5

# Known ports
API_PORT=3000
WEB_PORT=5173
STORYBOOK_PORT=6006
REDIS_PORT=6379
POSTGRES_PORT=5432
MAILPIT_SMTP_PORT=1025
MAILPIT_UI_PORT=8025
S3_PORT=4569

ALL_PORTS=($API_PORT $WEB_PORT $STORYBOOK_PORT $REDIS_PORT $POSTGRES_PORT $MAILPIT_SMTP_PORT $MAILPIT_UI_PORT $S3_PORT)
DEV_PORTS=($API_PORT $WEB_PORT $STORYBOOK_PORT)

# ANSI Colors
ESC=$(printf '\033')
RESET="${ESC}[0m"
BOLD="${ESC}[1m"
DIM="${ESC}[2m"

C_PRI="${ESC}[38;5;51m"    # Cyan
C_SEC="${ESC}[38;5;39m"    # Blue
C_ACC="${ESC}[38;5;33m"    # Darker blue
C_GREEN="${ESC}[38;5;118m"
C_RED="${ESC}[38;5;196m"
C_YELLOW="${ESC}[38;5;226m"
C_GRAY="${ESC}[38;5;240m"
C_WHITE="${ESC}[38;5;255m"
C_MUTE="${ESC}[38;5;248m"

# ============================================================================
# TERMINAL UTILITIES
# ============================================================================

TERM_COLS=$(tput cols 2>/dev/null || echo 80)

get_term_size() {
    TERM_COLS=$(tput cols 2>/dev/null || echo 80)
    TERM_LINES=$(tput lines 2>/dev/null || echo 24)
}

center_print() {
    local text="$1"
    local color="${2:-}"
    local len=${#text}
    local pad=$(( (TERM_COLS - len) / 2 ))
    [ $pad -lt 0 ] && pad=0
    printf "%${pad}s${color}%s${RESET}\n" "" "$text"
}

draw_line() {
    local char="${1:-─}"
    local color="${2:-$C_GRAY}"
    local width="${3:-58}"
    printf "${color}"
    for ((i=0; i<width; i++)); do printf "%s" "$char"; done
    printf "${RESET}"
}

hide_cursor() { printf "${ESC}[?25l"; }
show_cursor() { printf "${ESC}[?25h"; }

cleanup() {
    show_cursor
    stty echo icanon 2>/dev/null || true
    printf "${RESET}\n"
}

trap cleanup EXIT INT TERM

# ============================================================================
# PORT MANAGEMENT
# ============================================================================

get_pids_on_port() {
    local port=$1
    lsof -ti:"$port" 2>/dev/null || true
}

is_port_in_use() {
    local port=$1
    local pids
    pids=$(get_pids_on_port "$port")
    [ -n "$pids" ]
}

kill_port() {
    local port=$1
    local pids
    pids=$(get_pids_on_port "$port")

    if [ -z "$pids" ]; then
        return 0
    fi

    echo "$pids" | xargs kill -9 2>/dev/null || true

    local i=0
    while [ $i -lt 10 ]; do
        sleep 0.3 2>/dev/null || sleep 1
        if ! is_port_in_use "$port"; then
            return 0
        fi
        i=$((i + 1))
    done
    return 1
}

show_port_status() {
    get_term_size
    echo ""
    center_print "Port Status" "${BOLD}${C_WHITE}"
    echo ""

    local any_in_use=false
    local ports_info=(
        "$API_PORT:API Server"
        "$WEB_PORT:Vite Dev Server"
        "$STORYBOOK_PORT:Storybook"
        "$REDIS_PORT:Redis"
        "$POSTGRES_PORT:PostgreSQL"
        "$MAILPIT_SMTP_PORT:Mailpit SMTP"
        "$MAILPIT_UI_PORT:Mailpit UI"
        "$S3_PORT:S3rver"
    )

    for entry in "${ports_info[@]}"; do
        local port="${entry%%:*}"
        local name="${entry#*:}"
        local pids
        pids=$(get_pids_on_port "$port" | xargs 2>/dev/null)

        if [ -n "$pids" ]; then
            center_print "  $port  $name  PID: $pids" "$C_RED"
            any_in_use=true
        else
            center_print "  $port  $name" "$C_GREEN"
        fi
    done

    echo ""

    if [ "$any_in_use" = false ]; then
        center_print "All ports are free" "$C_GREEN"
        echo ""
        read -r -p "$(printf "%$(( (TERM_COLS - 30) / 2 ))s" "")Press Enter to continue..." _
        return
    fi

    center_print "What would you like to do?" "$C_WHITE"
    echo ""
    center_print "[A] Kill ALL occupied ports" "$C_RED"
    center_print "[D] Kill dev ports only ($API_PORT, $WEB_PORT)" "$C_YELLOW"
    center_print "[C] Enter custom port to kill" "$C_MUTE"
    center_print "[B] Back to menu" "$C_MUTE"
    echo ""

    show_cursor
    stty echo icanon 2>/dev/null || true

    while true; do
        local choice_pad=$(( (TERM_COLS - 20) / 2 ))
        printf "%${choice_pad}s" ""
        read -r -p "Choice: " choice

        case "$choice" in
            [aA])
                echo ""
                for entry in "${ports_info[@]}"; do
                    local port="${entry%%:*}"
                    local name="${entry#*:}"
                    if is_port_in_use "$port"; then
                        center_print "Killing $name on port $port..." "$C_YELLOW"
                        if kill_port "$port"; then
                            center_print "Port $port freed" "$C_GREEN"
                        else
                            center_print "Failed to free port $port" "$C_RED"
                        fi
                    fi
                done
                echo ""
                center_print "Done!" "$C_GREEN"
                sleep 1
                return
                ;;
            [dD])
                echo ""
                for port in "${DEV_PORTS[@]}"; do
                    if is_port_in_use "$port"; then
                        center_print "Killing process on port $port..." "$C_YELLOW"
                        if kill_port "$port"; then
                            center_print "Port $port freed" "$C_GREEN"
                        else
                            center_print "Failed to free port $port" "$C_RED"
                        fi
                    else
                        center_print "Port $port already free" "$C_GREEN"
                    fi
                done
                echo ""
                center_print "Done!" "$C_GREEN"
                sleep 1
                return
                ;;
            [cC])
                echo ""
                printf "%${choice_pad}s" ""
                read -r -p "Enter port number: " custom_port
                if [[ "$custom_port" =~ ^[0-9]+$ ]] && [ "$custom_port" -ge 1 ] && [ "$custom_port" -le 65535 ]; then
                    if is_port_in_use "$custom_port"; then
                        center_print "Killing process on port $custom_port..." "$C_YELLOW"
                        if kill_port "$custom_port"; then
                            center_print "Port $custom_port freed" "$C_GREEN"
                        else
                            center_print "Failed to free port $custom_port" "$C_RED"
                        fi
                    else
                        center_print "Port $custom_port is not in use" "$C_GREEN"
                    fi
                else
                    center_print "Invalid port number" "$C_RED"
                fi
                sleep 1
                return
                ;;
            [bB])
                return
                ;;
            *)
                center_print "Invalid choice. Enter A, D, C, or B." "$C_RED"
                ;;
        esac
    done
}

# ============================================================================
# PRE-FLIGHT CHECKS
# ============================================================================

check_required_commands() {
    local missing=()

    for cmd in node pnpm tput; do
        if ! command -v "$cmd" &> /dev/null; then
            missing+=("$cmd")
        fi
    done

    if [ ${#missing[@]} -gt 0 ]; then
        echo "${C_RED}Error:${RESET} Missing required commands: ${missing[*]}"
        echo ""
        for cmd in "${missing[@]}"; do
            case "$cmd" in
                node) echo "  - Node.js from https://nodejs.org/" ;;
                pnpm) echo "  - pnpm: npm install -g pnpm" ;;
                tput) echo "  - ncurses (usually pre-installed)" ;;
            esac
        done
        exit 1
    fi
}

check_dev_port_conflicts() {
    local mode="$1"
    local conflicts=false

    if [ "$mode" = "web" ] || [ "$mode" = "electron" ]; then
        if is_port_in_use "$API_PORT"; then
            local pids
            pids=$(get_pids_on_port "$API_PORT" | xargs 2>/dev/null)
            center_print "Port $API_PORT in use (PID: $pids)" "$C_YELLOW"
            conflicts=true
        fi
    fi

    if [ "$mode" = "web" ]; then
        if is_port_in_use "$WEB_PORT"; then
            local pids
            pids=$(get_pids_on_port "$WEB_PORT" | xargs 2>/dev/null)
            center_print "Port $WEB_PORT in use (PID: $pids)" "$C_YELLOW"
            conflicts=true
        fi
    fi

    if [ "$mode" = "storybook" ]; then
        if is_port_in_use "$STORYBOOK_PORT"; then
            local pids
            pids=$(get_pids_on_port "$STORYBOOK_PORT" | xargs 2>/dev/null)
            center_print "Port $STORYBOOK_PORT in use (PID: $pids)" "$C_YELLOW"
            conflicts=true
        fi
    fi

    if [ "$conflicts" = true ]; then
        echo ""
        center_print "[K] Kill conflicting ports and continue" "$C_GREEN"
        center_print "[I] Ignore and continue anyway" "$C_MUTE"
        center_print "[C] Cancel" "$C_RED"
        echo ""

        show_cursor
        stty echo icanon 2>/dev/null || true

        while true; do
            local choice_pad=$(( (TERM_COLS - 20) / 2 ))
            printf "%${choice_pad}s" ""
            read -r -p "Choice: " choice

            case "$choice" in
                [kK])
                    echo ""
                    if [ "$mode" = "web" ] || [ "$mode" = "electron" ]; then
                        if is_port_in_use "$API_PORT"; then
                            kill_port "$API_PORT"
                            center_print "Port $API_PORT freed" "$C_GREEN"
                        fi
                    fi
                    if [ "$mode" = "web" ]; then
                        if is_port_in_use "$WEB_PORT"; then
                            kill_port "$WEB_PORT"
                            center_print "Port $WEB_PORT freed" "$C_GREEN"
                        fi
                    fi
                    if [ "$mode" = "storybook" ]; then
                        if is_port_in_use "$STORYBOOK_PORT"; then
                            kill_port "$STORYBOOK_PORT"
                            center_print "Port $STORYBOOK_PORT freed" "$C_GREEN"
                        fi
                    fi
                    echo ""
                    return 0
                    ;;
                [iI])
                    return 0
                    ;;
                [cC])
                    return 1
                    ;;
                *)
                    center_print "Invalid choice. Enter K, I, or C." "$C_RED"
                    ;;
            esac
        done
    fi

    return 0
}

# ============================================================================
# SPINNER
# ============================================================================

spinner() {
    local text="$1"
    local frames=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
    local i=0
    local count=0
    local max_frames=20

    while [ $count -lt $max_frames ]; do
        local len=${#text}
        local pad_left=$(( (TERM_COLS - len - 4) / 2 ))
        [ $pad_left -lt 0 ] && pad_left=0
        printf "\r%${pad_left}s${C_PRI}${frames[$i]}${RESET} ${C_WHITE}%s${RESET}" "" "$text"
        i=$(( (i + 1) % ${#frames[@]} ))
        count=$((count + 1))
        sleep 0.1 2>/dev/null || sleep 1
    done

    local len=${#text}
    local pad_left=$(( (TERM_COLS - len - 4) / 2 ))
    [ $pad_left -lt 0 ] && pad_left=0
    printf "\r%${pad_left}s${C_GREEN}✓${RESET} ${C_WHITE}%s${RESET}   \n" "" "$text"
}

# ============================================================================
# UI DISPLAY
# ============================================================================

MENU_BOX_WIDTH=62
MENU_INNER_WIDTH=60

show_header() {
    clear
    get_term_size

    local top_pad=$(( TERM_LINES / 7 ))
    for ((i=0; i<top_pad; i++)); do echo ""; done

    local l1="  █  █ █ ▀▀█▀▀ █▀▀   ┃   █▀▀▄ █▀▀ █▀▀ ▀▀█▀▀    █  █▀▀  "
    local l2="  ▀▄▄▀ █   █   █▀▀   ┃   █  █ █▀▀ ▀▀█   █      █  ▀▀█  "
    local l3="   ▀▀  ▀   ▀   ▀▀▀   ┃   ▀  ▀ ▀▀▀ ▀▀▀   ▀   ▀▀█▀ ▀▀▀  "

    local logo_width=60
    local pad_left=$(( (TERM_COLS - logo_width) / 2 ))
    local pad=$(printf "%${pad_left}s" "")

    echo -e "${pad}${C_PRI}${l1}${RESET}"
    echo -e "${pad}${C_SEC}${l2}${RESET}"
    echo -e "${pad}${C_ACC}${l3}${RESET}"

    echo ""

    local version
    version="v$(node -p "require('$SCRIPT_DIR/package.json').version" 2>/dev/null || echo "0.0.0")"

    local sub_len=50
    local sub_pad=$(( (TERM_COLS - sub_len) / 2 ))
    printf "%${sub_pad}s" ""
    echo -e "${C_MUTE}Vite + NestJS + Electron Monorepo${RESET}  ${C_GRAY}│${RESET}  ${C_GREEN}${version}${RESET}"

    echo ""
    echo ""
}

show_menu() {
    local pad_left=$(( (TERM_COLS - MENU_BOX_WIDTH) / 2 ))
    local pad=$(printf "%${pad_left}s" "")
    local border="${C_GRAY}│${RESET}"

    printf "%s${C_GRAY}╭" "$pad"
    draw_line "─" "$C_GRAY" "$MENU_INNER_WIDTH"
    printf "╮${RESET}\n"

    # Menu items
    local sel1="" sel2="" sel3="" sel4="" sel5=""
    local txt1="${C_MUTE}" txt2="${C_MUTE}" txt3="${C_MUTE}" txt4="${C_MUTE}" txt5="${C_MUTE}"

    case $SELECTED_OPTION in
        1) sel1="${C_ACC}▸${RESET} ${C_PRI}"; txt1="${C_WHITE}" ;;
        2) sel2="${C_ACC}▸${RESET} ${C_PRI}"; txt2="${C_WHITE}" ;;
        3) sel3="${C_ACC}▸${RESET} ${C_PRI}"; txt3="${C_WHITE}" ;;
        4) sel4="${C_ACC}▸${RESET} ${C_PRI}"; txt4="${C_WHITE}" ;;
        5) sel5="${C_ACC}▸${RESET} ${C_PRI}"; txt5="${C_WHITE}" ;;
    esac

    [[ -z "$sel1" ]] && sel1="  ${C_MUTE}"
    [[ -z "$sel2" ]] && sel2="  ${C_MUTE}"
    [[ -z "$sel3" ]] && sel3="  ${C_MUTE}"
    [[ -z "$sel4" ]] && sel4="  ${C_MUTE}"
    [[ -z "$sel5" ]] && sel5="  ${C_MUTE}"

    printf "%s${border}  ${sel1}[1]${RESET}  ${txt1}Web Mode${RESET}          ${C_MUTE}API + Vite (localhost)${RESET}        ${border}\n" "$pad"
    printf "%s${border}  ${sel2}[2]${RESET}  ${txt2}Electron Mode${RESET}     ${C_MUTE}Desktop App (external API)${RESET}    ${border}\n" "$pad"
    printf "%s${border}  ${sel3}[3]${RESET}  ${txt3}Storybook${RESET}         ${C_MUTE}UI Components (port $STORYBOOK_PORT)${RESET}    ${border}\n" "$pad"
    printf "%s${border}  ${sel4}[4]${RESET}  ${txt4}Kill Ports${RESET}        ${C_MUTE}Free occupied dev ports${RESET}       ${border}\n" "$pad"

    printf "%s${C_GRAY}├" "$pad"
    draw_line "─" "$C_GRAY" "$MENU_INNER_WIDTH"
    printf "┤${RESET}\n"

    printf "%s${border}  ${sel5}[Q]${RESET}  ${C_MUTE}Exit${RESET}                                               ${border}\n" "$pad"

    printf "%s${C_GRAY}╰" "$pad"
    draw_line "─" "$C_GRAY" "$MENU_INNER_WIDTH"
    printf "╯${RESET}\n"

    echo ""
    local footer="[Up/Down] Navigate  [Enter] Select  [1-4] Quick  [Q] Exit"
    local f_pad=$(( (TERM_COLS - ${#footer}) / 2 ))
    printf "%${f_pad}s" ""
    echo -e "${DIM}${footer}${RESET}"
}

# ============================================================================
# INPUT HANDLING
# ============================================================================

read_key() {
    local key
    IFS= read -rsn1 key 2>/dev/null

    if [[ "$key" == $'\x1b' ]]; then
        # Read escape sequence one byte at a time (bash 3.2 doesn't support fractional -t)
        local bracket
        IFS= read -rsn1 -t 1 bracket 2>/dev/null || true
        if [[ "$bracket" == "[" ]]; then
            local code
            IFS= read -rsn1 -t 1 code 2>/dev/null || true
            case "$code" in
                A) echo "UP" ;;
                B) echo "DOWN" ;;
                *) echo "ESC" ;;
            esac
        else
            echo "ESC"
        fi
    elif [[ "$key" == "" ]]; then
        echo "ENTER"
    elif [[ "$key" == "q" || "$key" == "Q" ]]; then
        echo "QUIT"
    elif [[ "$key" =~ ^[1-5]$ ]]; then
        echo "$key"
    else
        echo ""
    fi
}

# ============================================================================
# PACKAGE BUILD
# ============================================================================

build_packages() {
    center_print "Building packages..." "$C_MUTE"
    echo ""
    pnpm build:packages --silent 2>&1 | tail -5
    center_print "Packages built" "$C_GREEN"
    echo ""
}

# ============================================================================
# LAUNCH MODES
# ============================================================================

launch_web() {
    show_header
    spinner "Preparing Web Mode"
    echo ""

    build_packages

    center_print "Starting API + Vite Dev Servers..." "$C_PRI"
    echo ""
    center_print "API:  http://localhost:$API_PORT" "$C_WHITE"
    center_print "Web:  http://localhost:$WEB_PORT" "$C_WHITE"
    echo ""

    show_cursor
    stty echo icanon 2>/dev/null || true

    # Remove the trap so we don't clear the screen
    trap - EXIT

    exec pnpm dev
}

launch_electron() {
    show_header
    spinner "Preparing Electron Mode"
    echo ""

    build_packages

    center_print "Starting API + Desktop App..." "$C_PRI"
    echo ""
    center_print "API:      http://localhost:$API_PORT" "$C_WHITE"
    center_print "Desktop:  Electron (app://app)" "$C_WHITE"
    echo ""

    show_cursor
    stty echo icanon 2>/dev/null || true

    trap - EXIT

    exec pnpm desktop:dev
}

launch_storybook() {
    show_header
    spinner "Preparing Storybook"
    echo ""

    build_packages

    center_print "Starting Storybook Dev Server..." "$C_PRI"
    echo ""
    center_print "Storybook:  http://localhost:$STORYBOOK_PORT" "$C_WHITE"
    echo ""

    show_cursor
    stty echo icanon 2>/dev/null || true

    trap - EXIT

    exec pnpm --filter @repo/ui storybook
}

# ============================================================================
# ARGUMENT PARSING
# ============================================================================

show_help() {
    cat << 'EOF'
SaaS Starter - TUI Launcher

USAGE:
  ./start.sh [MODE] [OPTIONS]

MODES:
  web              Launch API + Vite dev servers
  electron         Launch Electron desktop app
  storybook        Launch Storybook UI dev server
  kill-ports       Kill processes on dev ports

OPTIONS:
  --help           Show this help message

KEYBOARD SHORTCUTS (in menu):
  Up/Down arrows   Navigate between options
  Enter            Select highlighted option
  1-4              Jump to mode
  Q                Exit

EOF
}

# Handle CLI arguments
case "${1:-}" in
    --help|-h)
        show_help
        exit 0
        ;;
    web)
        check_required_commands
        get_term_size
        check_dev_port_conflicts "web" && launch_web
        exit 0
        ;;
    electron)
        check_required_commands
        get_term_size
        check_dev_port_conflicts "electron" && launch_electron
        exit 0
        ;;
    storybook)
        check_required_commands
        get_term_size
        check_dev_port_conflicts "storybook" && launch_storybook
        exit 0
        ;;
    kill-ports)
        check_required_commands
        get_term_size
        show_port_status
        exit 0
        ;;
esac

# ============================================================================
# MAIN LOOP
# ============================================================================

check_required_commands

while true; do
    show_header
    show_menu
    hide_cursor

    key=$(read_key)

    case "$key" in
        UP)
            SELECTED_OPTION=$(( SELECTED_OPTION - 1 ))
            [ $SELECTED_OPTION -lt 1 ] && SELECTED_OPTION=$MAX_OPTIONS
            ;;
        DOWN)
            SELECTED_OPTION=$(( SELECTED_OPTION + 1 ))
            [ $SELECTED_OPTION -gt $MAX_OPTIONS ] && SELECTED_OPTION=1
            ;;
        ENTER)
            show_cursor
            case $SELECTED_OPTION in
                1)
                    get_term_size
                    check_dev_port_conflicts "web" && launch_web
                    ;;
                2)
                    get_term_size
                    check_dev_port_conflicts "electron" && launch_electron
                    ;;
                3)
                    get_term_size
                    check_dev_port_conflicts "storybook" && launch_storybook
                    ;;
                4)
                    show_port_status
                    ;;
                5)
                    echo ""
                    center_print "Goodbye!" "$C_MUTE"
                    exit 0
                    ;;
            esac
            ;;
        1)
            SELECTED_OPTION=1
            show_cursor
            get_term_size
            check_dev_port_conflicts "web" && launch_web
            ;;
        2)
            SELECTED_OPTION=2
            show_cursor
            get_term_size
            check_dev_port_conflicts "electron" && launch_electron
            ;;
        3)
            SELECTED_OPTION=3
            show_cursor
            get_term_size
            check_dev_port_conflicts "storybook" && launch_storybook
            ;;
        4)
            SELECTED_OPTION=4
            show_cursor
            show_port_status
            ;;
        QUIT)
            echo ""
            center_print "Goodbye!" "$C_MUTE"
            exit 0
            ;;
    esac
done
