export namespace main {
	
	export class AIAnalysisRequest {
	    provider: string;
	    mode: string;
	    endpoint: string;
	    apiKey: string;
	    model: string;
	    prompt: string;
	    context: string;
	    conversation: string;
	    question: string;
	
	    static createFrom(source: any = {}) {
	        return new AIAnalysisRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.provider = source["provider"];
	        this.mode = source["mode"];
	        this.endpoint = source["endpoint"];
	        this.apiKey = source["apiKey"];
	        this.model = source["model"];
	        this.prompt = source["prompt"];
	        this.context = source["context"];
	        this.conversation = source["conversation"];
	        this.question = source["question"];
	    }
	}
	export class AIAnalysisResponse {
	    reply: string;
	
	    static createFrom(source: any = {}) {
	        return new AIAnalysisResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.reply = source["reply"];
	    }
	}
	export class ModelsResponse {
	    models: string[];
	
	    static createFrom(source: any = {}) {
	        return new ModelsResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.models = source["models"];
	    }
	}
	export class TestResponse {
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new TestResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.message = source["message"];
	    }
	}
	export class TranslateRequest {
	    provider: string;
	    mode: string;
	    endpoint: string;
	    apiKey: string;
	    model: string;
	    sourceLang: string;
	    targetLang: string;
	    prompt: string;
	    names: string[];
	
	    static createFrom(source: any = {}) {
	        return new TranslateRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.provider = source["provider"];
	        this.mode = source["mode"];
	        this.endpoint = source["endpoint"];
	        this.apiKey = source["apiKey"];
	        this.model = source["model"];
	        this.sourceLang = source["sourceLang"];
	        this.targetLang = source["targetLang"];
	        this.prompt = source["prompt"];
	        this.names = source["names"];
	    }
	}
	export class TranslateResponse {
	    translations: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new TranslateResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.translations = source["translations"];
	    }
	}

}

