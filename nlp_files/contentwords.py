import nltk

#Only argument should be the file name of the text file to be edited.
#The input file will not be changed. A new output file will be created.
filename = sys.argv
outputText = ""

with open(filename, "r", "utf-8") as input:
	with open("stopwords", "r", "utf-8") as stopwordsFile:
		inputwords = input.read().split()
		stopwords = stopwordsFile.read().split()

		#don't tokenize text to maintain indexes - don't want to split "didn't" into "did" and "n't"
		
		#for each word,
		#check if it's in stopwords
		#if not, replace that word with the same thing except with a fixation tag


		#Performance really doesn't matter for this script for my purposes.
		#This part should be fixed if it matters for you. (Technically it's still linear not N^2, but this isn't the best way)
		for index, word in enumerate(inputwords):
			if word not in stopwords:
				inputwords[index] = "<span class=\"impulse-fixation\">" + word + "</span>"	
	

#write that text to a new file


sentence = """At eight o'clock on Thursday morning"""
tokens = nltk.word_tokenize(sentence)
print(tokens)