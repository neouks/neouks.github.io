package main

import (
	"reflect"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestNormalizeAIEndpoints(t *testing.T) {
	tests := []struct {
		name       string
		input      string
		completion string
		models     string
	}{
		{
			name:       "base endpoint",
			input:      "https://api.example.test/v1/",
			completion: "https://api.example.test/v1/chat/completions",
			models:     "https://api.example.test/v1/models",
		},
		{
			name:       "completion endpoint",
			input:      "https://api.example.test/v1/chat/completions",
			completion: "https://api.example.test/v1/chat/completions",
			models:     "https://api.example.test/v1/models",
		},
		{
			name:       "models endpoint",
			input:      "https://api.example.test/v1/models",
			completion: "https://api.example.test/v1/chat/completions",
			models:     "https://api.example.test/v1/models",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := normalizeAIEndpoint(test.input); got != test.completion {
				t.Fatalf("normalizeAIEndpoint() = %q, want %q", got, test.completion)
			}
			if got := normalizeModelsEndpoint(test.input); got != test.models {
				t.Fatalf("normalizeModelsEndpoint() = %q, want %q", got, test.models)
			}
		})
	}
}

func TestParseTranslations(t *testing.T) {
	tests := []struct {
		name    string
		content string
		want    map[string]string
	}{
		{
			name:    "wrapped markdown JSON",
			content: "```json\n{\"translations\":{\" Engine speed \":\" 发动机转速 \"}}\n```",
			want:    map[string]string{"Engine speed": "发动机转速"},
		},
		{
			name:    "direct object",
			content: `{"Boost":"增压","":"ignored"}`,
			want:    map[string]string{"Boost": "增压"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := parseTranslations(test.content)
			if err != nil {
				t.Fatalf("parseTranslations() error = %v", err)
			}
			if !reflect.DeepEqual(got, test.want) {
				t.Fatalf("parseTranslations() = %#v, want %#v", got, test.want)
			}
		})
	}
}

func TestCompactUniqueNames(t *testing.T) {
	got := compactUniqueNames([]string{" Engine speed ", "", "Engine speed", "Boost"})
	want := []string{"Engine speed", "Boost"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("compactUniqueNames() = %#v, want %#v", got, want)
	}
}

func TestCompactErrorBodyPreservesUTF8(t *testing.T) {
	got := compactErrorBody([]byte(strings.Repeat("数", 300)))
	if !utf8.ValidString(got) {
		t.Fatal("compactErrorBody() returned invalid UTF-8")
	}
	if runeCount := utf8.RuneCountInString(got); runeCount != 243 {
		t.Fatalf("compactErrorBody() rune count = %d, want 243", runeCount)
	}
}
