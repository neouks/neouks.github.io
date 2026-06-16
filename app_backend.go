package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type App struct{}

type TranslateRequest struct {
	Provider   string   `json:"provider"`
	Mode       string   `json:"mode"`
	Endpoint   string   `json:"endpoint"`
	APIKey     string   `json:"apiKey"`
	Model      string   `json:"model"`
	SourceLang string   `json:"sourceLang"`
	TargetLang string   `json:"targetLang"`
	Prompt     string   `json:"prompt"`
	Names      []string `json:"names"`
}

type TranslateResponse struct {
	Translations map[string]string `json:"translations"`
}

type TestResponse struct {
	Message string `json:"message"`
}

type ModelsResponse struct {
	Models []string `json:"models"`
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatCompletionRequest struct {
	Model          string        `json:"model"`
	Messages       []chatMessage `json:"messages"`
	Temperature    float64       `json:"temperature"`
	ResponseFormat *struct {
		Type string `json:"type"`
	} `json:"response_format,omitempty"`
}

type chatCompletionResponse struct {
	Choices []struct {
		Message struct {
			Role             string `json:"role"`
			Content          any    `json:"content"`
			ReasoningContent string `json:"reasoning_content"`
		} `json:"message"`
	} `json:"choices"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error,omitempty"`
}

func NewApp() *App {
	return &App{}
}

func (a *App) TranslateMeasureNames(req TranslateRequest) (*TranslateResponse, error) {
	endpoint := strings.TrimSpace(req.Endpoint)
	apiKey := strings.TrimSpace(req.APIKey)
	model := strings.TrimSpace(req.Model)
	names := compactUniqueNames(req.Names)
	mode := strings.ToLower(strings.TrimSpace(req.Mode))
	provider := strings.ToLower(strings.TrimSpace(req.Provider))
	sourceLang := normalizeLang(req.SourceLang, "auto")
	targetLang := normalizeLang(req.TargetLang, "zh")
	extraPrompt := strings.TrimSpace(req.Prompt)

	if endpoint == "" {
		return nil, errors.New("请填写 AI API 地址")
	}
	if apiKey == "" {
		return nil, errors.New("请填写 AI API Key")
	}
	if model == "" && mode != "deepl" && provider != "deepl" {
		return nil, errors.New("请填写 AI 模型")
	}
	if len(names) == 0 {
		return &TranslateResponse{Translations: map[string]string{}}, nil
	}
	if mode == "deepl" || provider == "deepl" {
		translations, err := translateWithDeepL(endpoint, apiKey, sourceLang, targetLang, names)
		if err != nil {
			return nil, err
		}
		return &TranslateResponse{Translations: translations}, nil
	}
	body, err := json.Marshal(chatCompletionRequest{
		Model:       model,
		Temperature: 0.1,
		ResponseFormat: &struct {
			Type string `json:"type"`
		}{Type: "json_object"},
		Messages: []chatMessage{
			{
				Role:    "system",
				Content: fmt.Sprintf("你是汽车ECU数据流字段翻译助手。请%s，输出简洁专业译名，保留缩写、传感器编号、单位、实际值/规定值含义。只返回JSON对象，格式为 {\"translations\":{\"原文\":\"译文\"}}，不要输出解释。%s", translationDirection(sourceLang, targetLang), extraInstruction(extraPrompt)),
			},
			{
				Role:    "user",
				Content: buildTranslatePrompt(names, sourceLang, targetLang),
			},
		},
	})
	if err != nil {
		return nil, err
	}

	url := normalizeAIEndpoint(endpoint)

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("AI API 请求失败：HTTP %d %s", resp.StatusCode, compactErrorBody(raw))
	}

	var completion chatCompletionResponse
	if err := json.Unmarshal(raw, &completion); err != nil {
		return nil, fmt.Errorf("AI 响应解析失败：%w", err)
	}
	if completion.Error != nil && completion.Error.Message != "" {
		return nil, errors.New(completion.Error.Message)
	}
	if len(completion.Choices) == 0 {
		return nil, errors.New("AI 响应为空")
	}

	messageContent, err := extractMessageContent(completion.Choices[0].Message.Content, completion.Choices[0].Message.ReasoningContent)
	if err != nil {
		return nil, err
	}
	translations, err := parseTranslations(messageContent)
	if err != nil {
		return nil, err
	}
	return &TranslateResponse{Translations: translations}, nil
}

func (a *App) TestAIAPI(req TranslateRequest) (*TestResponse, error) {
	if strings.EqualFold(req.Provider, "deepl") || strings.EqualFold(req.Mode, "deepl") {
		if _, err := translateWithDeepL(strings.TrimSpace(req.Endpoint), strings.TrimSpace(req.APIKey), normalizeLang(req.SourceLang, "auto"), normalizeLang(req.TargetLang, "zh"), []string{"Engine speed"}); err != nil {
			return nil, err
		}
		return &TestResponse{Message: "DeepL API 测试成功，翻译接口可用。"}, nil
	}
	req.Names = []string{"Engine speed", "Boost pressure actual value"}
	resp, err := a.TranslateMeasureNames(req)
	if err != nil {
		return nil, err
	}
	if len(resp.Translations) == 0 {
		return &TestResponse{Message: "API 可连接，但没有返回翻译内容。"}, nil
	}
	return &TestResponse{Message: "API 测试成功，翻译接口可用。"}, nil
}

func (a *App) ListAIModels(req TranslateRequest) (*ModelsResponse, error) {
	if strings.EqualFold(req.Provider, "deepl") || strings.EqualFold(req.Mode, "deepl") {
		return &ModelsResponse{Models: []string{"deepl-translate"}}, nil
	}

	endpoint := strings.TrimSpace(req.Endpoint)
	apiKey := strings.TrimSpace(req.APIKey)
	if endpoint == "" {
		return nil, errors.New("请填写 AI API 地址")
	}
	if apiKey == "" {
		return nil, errors.New("请填写 AI API Key")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, normalizeModelsEndpoint(endpoint), nil)
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("获取模型失败：HTTP %d %s", resp.StatusCode, compactErrorBody(raw))
	}

	var payload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
		Models []struct {
			Name string `json:"name"`
			ID   string `json:"id"`
		} `json:"models"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("模型列表解析失败：%w", err)
	}
	models := make([]string, 0, len(payload.Data)+len(payload.Models))
	seen := map[string]bool{}
	for _, item := range payload.Data {
		addModel(&models, seen, item.ID)
	}
	for _, item := range payload.Models {
		if item.ID != "" {
			addModel(&models, seen, item.ID)
		} else {
			addModel(&models, seen, item.Name)
		}
	}
	return &ModelsResponse{Models: models}, nil
}

func buildTranslatePrompt(names []string, sourceLang, targetLang string) string {
	payload, _ := json.Marshal(names)
	return fmt.Sprintf("请%s以下ECU日志数据流字段名。返回JSON对象：{\"translations\":{\"原文\":\"译文\"}}。\n字段列表：%s", translationDirection(sourceLang, targetLang), string(payload))
}

func extraInstruction(prompt string) string {
	prompt = strings.TrimSpace(prompt)
	if prompt == "" {
		return ""
	}
	return "额外要求：" + prompt
}

func normalizeLang(value, fallback string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return fallback
	}
	return value
}

func langLabel(code string) string {
	switch normalizeLang(code, "zh") {
	case "auto":
		return "自动识别"
	case "zh":
		return "中文"
	case "en":
		return "英语"
	case "ja":
		return "日语"
	case "de":
		return "德语"
	case "fr":
		return "法语"
	case "es":
		return "西班牙语"
	case "ko":
		return "韩语"
	case "ru":
		return "俄语"
	default:
		return code
	}
}

func translationDirection(sourceLang, targetLang string) string {
	source := "自动识别源语言"
	if normalizeLang(sourceLang, "auto") != "auto" {
		source = "从" + langLabel(sourceLang)
	}
	return source + "翻译为" + langLabel(targetLang)
}

func normalizeAIEndpoint(endpoint string) string {
	url := strings.TrimRight(strings.TrimSpace(endpoint), "/")
	if strings.HasSuffix(url, "/chat/completions") {
		return url
	}
	return url + "/chat/completions"
}

func normalizeModelsEndpoint(endpoint string) string {
	url := strings.TrimRight(strings.TrimSpace(endpoint), "/")
	if strings.HasSuffix(url, "/models") {
		return url
	}
	if strings.HasSuffix(url, "/chat/completions") {
		return strings.TrimSuffix(url, "/chat/completions") + "/models"
	}
	return url + "/models"
}

func translateWithDeepL(endpoint, apiKey, sourceLang, targetLang string, names []string) (map[string]string, error) {
	endpoint = strings.TrimRight(strings.TrimSpace(endpoint), "/")
	apiKey = strings.TrimSpace(apiKey)
	if endpoint == "" {
		return nil, errors.New("请填写 DeepL API 地址")
	}
	if apiKey == "" {
		return nil, errors.New("请填写 DeepL API Key")
	}
	if len(names) == 0 {
		return map[string]string{}, nil
	}

	form := url.Values{}
	form.Set("target_lang", deepLLangCode(targetLang))
	if source := deepLLangCode(sourceLang); source != "AUTO" {
		form.Set("source_lang", source)
	}
	for _, name := range names {
		form.Add("text", name)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint+"/translate", strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	httpReq.Header.Set("Authorization", "DeepL-Auth-Key "+apiKey)

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("DeepL 请求失败：HTTP %d %s", resp.StatusCode, compactErrorBody(raw))
	}

	var payload struct {
		Translations []struct {
			Text string `json:"text"`
		} `json:"translations"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("DeepL 响应解析失败：%w", err)
	}
	result := make(map[string]string, len(payload.Translations))
	for i, item := range payload.Translations {
		if i >= len(names) {
			break
		}
		if strings.TrimSpace(item.Text) != "" {
			result[names[i]] = strings.TrimSpace(item.Text)
		}
	}
	return result, nil
}

func deepLLangCode(code string) string {
	switch normalizeLang(code, "zh") {
	case "auto":
		return "AUTO"
	case "zh":
		return "ZH"
	case "en":
		return "EN"
	case "ja":
		return "JA"
	case "de":
		return "DE"
	case "fr":
		return "FR"
	case "es":
		return "ES"
	case "ko":
		return "KO"
	case "ru":
		return "RU"
	default:
		return strings.ToUpper(code)
	}
}

func addModel(models *[]string, seen map[string]bool, model string) {
	model = strings.TrimSpace(model)
	if model == "" || seen[model] {
		return
	}
	seen[model] = true
	*models = append(*models, model)
}

func compactUniqueNames(names []string) []string {
	seen := make(map[string]bool, len(names))
	result := make([]string, 0, len(names))
	for _, name := range names {
		name = strings.TrimSpace(name)
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		result = append(result, name)
	}
	return result
}

func parseTranslations(content string) (map[string]string, error) {
	content = strings.TrimSpace(content)
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")
	content = strings.TrimSpace(content)

	var wrapped struct {
		Translations map[string]string `json:"translations"`
	}
	if err := json.Unmarshal([]byte(content), &wrapped); err == nil && wrapped.Translations != nil {
		return cleanTranslations(wrapped.Translations), nil
	}

	var direct map[string]string
	if err := json.Unmarshal([]byte(content), &direct); err == nil {
		return cleanTranslations(direct), nil
	}

	return nil, errors.New("AI 没有返回有效的翻译 JSON")
}

func extractMessageContent(content any, reasoning string) (string, error) {
	switch value := content.(type) {
	case string:
		return strings.TrimSpace(value), nil
	case []any:
		var parts []string
		for _, item := range value {
			switch typed := item.(type) {
			case string:
				if text := strings.TrimSpace(typed); text != "" {
					parts = append(parts, text)
				}
			case map[string]any:
				if text, ok := typed["text"].(string); ok && strings.TrimSpace(text) != "" {
					parts = append(parts, strings.TrimSpace(text))
					continue
				}
				if text, ok := typed["content"].(string); ok && strings.TrimSpace(text) != "" {
					parts = append(parts, strings.TrimSpace(text))
				}
			}
		}
		if len(parts) > 0 {
			return strings.TrimSpace(strings.Join(parts, "\n")), nil
		}
	}
	if strings.TrimSpace(reasoning) != "" {
		return strings.TrimSpace(reasoning), nil
	}
	return "", errors.New("AI 没有返回可解析的消息内容")
}

func cleanTranslations(input map[string]string) map[string]string {
	output := make(map[string]string, len(input))
	for k, v := range input {
		key := strings.TrimSpace(k)
		value := strings.TrimSpace(v)
		if key == "" || value == "" {
			continue
		}
		output[key] = value
	}
	return output
}

func compactErrorBody(raw []byte) string {
	text := strings.TrimSpace(string(raw))
	if text == "" {
		return ""
	}
	if len(text) > 240 {
		text = text[:240] + "..."
	}
	return text
}
